"""Shared helpers: turn raw OData rows from YY1_Store_Pending_PR into the compact format the dashboard reads."""
import re
from datetime import date

# Only the fields the dashboard uses. Asking SAP for just these keeps the live call small and fast.
FIELDS = [
    'PurchaseRequisition', 'PurchaseRequisitionItem', 'Plant', 'StorageLocation', 'PurchasingGroup',
    'PurchaseRequisitionType', 'Material', 'PurchaseRequisitionItemText', 'RequestedQuantity', 'OrderedQuantity',
    'BaseUnit_1', 'ItemNetAmount', 'PurchaseReqnCreationDate', 'DeliveryDate', 'ProcessingStatus', 'IsClosed',
    'CreatedByUser', 'PurchasingDocument', 'RequisitionerName', 'PurchaseRequisitionReleaseDate', 'PurReqCreationDate',
]

_ST = {'N': 0, 'B': 1, 'A': 2}

# Store issue from YY1_STORE_RESERVATION_CDS: goods issues to cost center (201) and their reversals (202),
# posted from 1 Jan 2026. Movement types 261 / 262 (issue to order) are not wanted.
ISSUE_FIELDS = [
    'PostingDate', 'GoodsMovementType_1', 'DebitCreditCode', 'CostCenter', 'CostCenter_1', 'CostCenterName',
    'Plant', 'StorageLocation', 'Material', 'ProductName', 'QuantityInBaseUnit', 'MaterialBaseUnit',
    'TotalGoodsMvtAmtInCCCrcy', 'CreatedByUser', 'Reservation', 'MaterialDocument',
    # SAP only sorts on selected fields, and without a stable sort the pages skip and repeat rows.
    'MaterialDocumentYear', 'MaterialDocumentItem',
    # UserID is the user who created the reservation; CreatedByUser is the user who posted the goods issue.
    'UserID',
]
# Purchase orders (items with supplier) from YY1_PO_ITEM_SUPPLIER_CDS, by PO creation date from 1 Jan 2026.
# The sort fields are the key of the view, so the pages do not skip or repeat rows.
PO_FIELDS = [
    'PurchaseOrder', 'PurchaseOrderItem', 'PurchaseOrderType', 'CreatedByUser', 'CreationDate', 'PurchaseOrderDate',
    'ReleaseIsNotCompleted', 'PurchasingProcessingStatus', 'PurchasingOrganization', 'PurchasingGroup',
    'Supplier', 'SupplierName', 'TaxNumber3', 'DocumentCurrency', 'MaterialGroup', 'Material', 'MaterialType',
    'PurchaseOrderItemText', 'Plant', 'StorageLocation', 'NetAmount', 'OrderQuantity', 'NetPriceAmount',
    'PurchaseOrderQuantityUnit',
]
# The supplier view repeats every PO item many times (about 5 times on average, up to 81) and only the "delivered" flag differs
# between the repeats, so items are counted once and the delivery comes from YY1_PO_ITEM_STATUS_CDS (same key, no date field).
PO_STATUS_FIELDS = ['PurchaseOrder', 'PurchaseOrderItem', 'GoodsReceiptQty', 'StillToBeDeliveredQuantity']
PO_DATE_FILTER = "CreationDate ge datetime'2026-01-01T00:00:00'"

# Store stock from YY1_STORE_STOCK_CDS: an analytical view with the parameter P_DisplayCurrency (INR), read as
# YY1_Store_Stock(P_DisplayCurrency='INR')/Results. The measures (stock quantity, stock value) are added up over the fields that are not
# selected, so the grain here is material + plant + storage location + stock type + special stock. SAP does not allow a filter on a measure,
# so the zero rows (about 4 of 5) are dropped in stock_compact.
STOCK_FIELDS = [
    'Product', 'ProductName', 'ProductType', 'ProductGroup', 'Plant', 'StorageLocation', 'StorageLocationName', 'InventoryStockType',
    'InventorySpecialStockType', 'MaterialBaseUnit', 'MatlWrhsStkQtyInMatlBaseUnit', 'StockValueInDisplayCurrency',
]
STOCK_ORDER = 'Plant,StorageLocation,Product,InventoryStockType,InventorySpecialStockType'
# Last use of a material: goods issues (stock out, DebitCreditCode H) read from the Store Issue view YY1_STORE_RESERVATION_CDS since 1 Jan 2026.
# The stock page flags stock that has had no consumption for 5 months. CONSUME_MVTS are the movement types that count as use: goods issue to
# a cost center (201), project (221), asset (241), production order (261), network (281), other account assignment (291) and consumption of
# material provided to a subcontractor (543). Transfers between stores (311, 321, 343 ...), scrapping, deliveries and returns do not count.
CONSUME_FIELDS = ['Plant', 'Material', 'PostingDate', 'GoodsMovementType_1', 'DebitCreditCode', 'QuantityInBaseUnit',
                  'MaterialDocumentYear', 'MaterialDocument', 'MaterialDocumentItem']
CONSUME_MVTS = ('201', '221', '241', '261', '281', '291', '543')

ISSUE_MVTS = ('201', '202')
ISSUE_DATE_FILTER = "PostingDate ge datetime'2026-01-01T00:00:00'"
ISSUE_FILTER = ISSUE_DATE_FILTER + ' and (' + ' or '.join(f"GoodsMovementType_1 eq '{m}'" for m in ISSUE_MVTS) + ')'

# Purchasing group -> description, the PGr / Description list the user sent from SAP on 18-Oct-2026 (names are spelled as in SAP).
# A code that is not listed is shown as its number.
PG_NAMES = {
    '001': 'Group 001',
    '002': 'Group 002',
    '003': 'Group 003',
    '010': 'Store Purchase',
    '020': 'VP Purchase',
    '030': 'Craft Purchase',
    '101': 'RM Charging',
    '102': 'CCP Division',
    '103': 'COIL Division',
    '104': 'COIN Division',
    '105': 'CASE Division',
    '106': 'CUP Division',
    '107': 'ME. MAINT CCP',
    '108': 'ME. MAINT CUP',
    '109': 'EE MAINT CCP',
    '110': 'PROJECT',
    '111': 'PMO',
    '112': 'HR',
    '113': 'ADMIN',
    '114': 'DESPATCH',
    '115': 'STORE',
    '116': 'PRODUCT DEVLOPMENT',
    '117': 'EQUIP. DEVELOPMENT',
    '118': 'Medal',
    '119': 'CUP TOOL ROOM',
    '120': 'COIN TOOL ROOM',
    '121': 'CASE TOOL ROOM',
    '122': 'ME. MAINT COIN',
    '123': 'ME. MAINT COIL',
    '124': 'ME. MAINT CASE',
    '125': 'EE. MAINT COIL',
    '126': 'EE. MAINT COIN',
    '127': 'EE. MAINT CUP',
    '128': 'EE. MAINT CASE',
    '129': 'Subcon Pur Group',
}

# Material group -> description: the Matl Group / Material Group Desc. list the user sent from SAP on 18-Oct-2026 (names are cut at 20 characters
# by SAP). A code that is not listed is shown as its number.
MG_NAMES = {
    '10 BAHT': '10 BAHT',
    '1101': 'Copper',
    '1102': 'Brass Scrap',
    '1103': 'Copper Nickel Brass',
    '1104': 'Nickel Silver Scrap',
    '1105': 'Zinc',
    '1106': 'Nickel',
    '1107': 'Cu Phosphorus',
    '1108': 'Mn Metal',
    '1109': 'TIN',
    '1110': 'Alloy Steel Material',
    '1111': 'Silver',
    '1201': 'Brass Strip 70/30',
    '1202': 'Brass Cup',
    '1203': 'Brass Cup 90/10',
    '1204': 'Brass Disc',
    '1205': 'Copper Alloys Coin B',
    '1206': 'Nickle Brass Coin B',
    '1207': 'Composite Coin Blank',
    '1208': 'Copper Alloys Coin B',
    '1209': 'Cartridge Case',
    '1210': 'Brass Tube',
    '1211': 'Silver Medal',
    '1212': 'Silver Coin',
    '1213': 'Brass Coin',
    '1214': 'Imitation Jewellery',
    '1215': 'Brass Cup 70/30',
    '1216': 'Brass Coil',
    '1217': 'Service Medal',
    '1218': 'Cu ETP',
    '1301': 'CCP',
    '1302': 'COIL',
    '1303': 'CUP',
    '1304': 'COIN',
    '1305': 'CASE',
    '1306': 'MEDAL',
    '1307': 'DISC',
    '1401': 'Silver Webbing',
    '1402': 'DROSS BR-30',
    '1403': 'CCP- BR-30',
    '1404': 'CCP- BR30',
    '1405': 'CUP-BR30',
    '1406': 'RM-BR05',
    '1407': 'RM-BR10',
    '1408': 'RM-BR28',
    '1409': 'RM-BR37',
    '1410': 'RM-NS20',
    '1411': 'RM-NS02',
    '1412': 'RM-NS05',
    '1413': 'RM-NS12.5',
    '1414': 'RM-CN25',
    '1415': 'CCP-BR05',
    '1416': 'CCP-BR10',
    '1417': 'CCP-BR28',
    '1418': 'CCP-BR37',
    '1419': 'CCP-NS20',
    '1420': 'CCP-NS02',
    '1421': 'CCP-NS05',
    '1422': 'CCP-NS12.5',
    '1423': 'CCP-CN25',
    '1424': 'DROSS-BR05',
    '1425': 'DROSS-BR10',
    '1426': 'DROSS-BR28',
    '1427': 'DROSS-BR37',
    '1428': 'DROSS-NS20',
    '1429': 'DROSS-NS02',
    '1430': 'DROSS-NS05',
    '1431': 'DROSS-NS12.5',
    '1432': 'DROSS-CN25',
    '1433': 'COIL-BR05',
    '1434': 'COIL-BR10',
    '1435': 'COIL-BR28',
    '1436': 'COIL-BR30',
    '1437': 'COIL-BR37',
    '1438': 'COIL-NS20',
    '1439': 'COIL-NS02',
    '1440': 'COIL-NS05',
    '1441': 'COIL-NS12.5',
    '1442': 'COIL-CN25',
    '1443': 'COIN-NS20',
    '1444': 'COIN-NS02',
    '1445': 'COIN-NS05',
    '1446': 'COIN-NS12.5',
    '1447': 'COIN-CN25',
    '1448': 'MEDAL-BR05',
    '1449': 'MEDAL-BR10',
    '1450': 'MEDAL-BR28',
    '1451': 'MEDAL-BR37',
    '1452': 'MEDAL-CN25',
    '1453': 'DISC-BR28',
    '1454': 'DISC-BR30',
    '1455': 'CUP-BR10',
    '1456': 'CUP-BR28',
    '1457': 'CASE-BR28',
    '1458': 'CASE-BR30',
    '1459': 'MEDAL-BR30',
    '1460': 'COIN-RS5',
    '1461': 'CCP-BR30',
    '1462': 'CCP-RS5',
    '1463': 'COIL-NS10',
    '1464': 'CCP DROSS-MIX',
    '1465': 'RM-N20',
    '1466': 'POWDER-DR',
    '1467': 'CCP-AL06',
    '1468': 'CCP-BILLET',
    '1469': 'DRUID-MILL BREEY',
    '1470': 'DRUID-COPPER CLOVE',
    '1471': 'RM-MILL BREEY',
    '1472': 'RM-COPPER CLOVE',
    '1473': 'RM-MIX COPPER',
    '1474': 'CCP-HF MIX',
    '1475': 'RM-HF MIX',
    '1476': 'RM-MIX Copper',
    '1477': 'RM-BR30',
    '1478': 'RM-RS5',
    '1479': 'MLSF-BR05',
    '1480': 'MLSF-BR10',
    '1481': 'MLSF-BR28',
    '1482': 'MLSF-BR30',
    '1483': 'MLSF-BR37',
    '1484': 'MLSF-NS20',
    '1485': 'MLSF-NS02',
    '1486': 'MLSF-NS05',
    '1487': 'MLSF-RS5',
    '1488': 'MLSF-NS12.5',
    '1489': 'MLSF-CN25',
    '1490': 'DROSS-BR30',
    '1491': 'DROSS-RS5',
    '1492': 'COIL-RS5',
    '1493': 'CUP-BR30',
    '1494': 'RM-BR32',
    '1495': 'RM-BR43',
    '1496': 'DRUID-CU',
    '1497': 'RM-CU',
    '1498': 'RM-MIX',
    '1499': 'CCP DROSS-MIX',
    '1501': 'Aluminium Ingots',
    '1502': 'Copper Ingot',
    '1503': 'Cable',
    '1504': 'Polyphenylene Sulfid',
    '1505': 'Ferro Nickel',
    '1506': 'Nickel',
    '1507': 'Nickel Cathode',
    '1508': 'Degummed Soya Oil',
    '1509': 'Copper Cathode',
    '1510': 'Copper Scrap',
    '1511': 'Brass Scrap',
    '1512': 'Zinc Ingots',
    '1513': 'Tin Ingots',
    '1514': 'Copperware',
    '1515': 'Handicraft',
    '1516': 'Imported articles',
    '1517': 'Coins & Lsa',
    '1518': 'Corp Gifting',
    '1519': 'Defence',
    '1520': 'Copper Wire',
    '1601': 'Coin Master M/C Sp',
    '1602': 'CCP M/C Tool Spare',
    '1603': 'Cup Die Cage Spare',
    '1604': 'Air Compressor Spare',
    '1605': 'Back Furnace Spare',
    '1606': 'Bell Annealing Spare',
    '1607': 'Case Press Spare',
    '1608': 'Case SPM Spare',
    '1609': 'Crane Spare',
    '1610': 'Tool Room Spare',
    '1611': 'Cupping Press Spare',
    '1612': 'Druid Spare',
    '1613': 'Elec Crane Spare',
    '1614': 'Hydraulic Spare',
    '1615': 'MRV Die & Tools',
    '1616': 'MRV Machine Spare',
    '1617': 'N2 Plant Spare',
    '1618': 'Pneumatic Spare',
    '1619': 'Polishing Bowl Spare',
    '1620': 'Pulvrizer Spare',
    '1621': 'Pump & Motor',
    '1622': 'Rimming M/C Spare',
    '1623': 'Rolling Mill Spare',
    '1624': 'Schuller Press Spare',
    '1625': 'Spectro Lab Spare',
    '1626': 'VFD & Controllers',
    '1627': 'Heating Element',
    '1628': 'QC Measuring Instru.',
    '1629': 'Job Work Case Spare',
    '1630': 'Job Work Cup Spare',
    '1632': 'Job Work Druid Spare',
    '1633': 'Job Work Gen. Item',
    '1634': 'Job Work Mech Spare',
    '1635': 'Job Work QC Spare',
    '1636': 'Job Work Medal Spare',
    '1637': 'Medal Blank Die & Sp',
    '1638': 'Medal Machine Spare',
    '1639': 'Medal Min Die & Sp',
    '1640': 'Craft Steel Die & Sp',
    '1641': 'Job Work Craft Spare',
    '1642': 'CRAFT ELECTRICAL SPA',
    '1643': 'CRAFT MECH SPARE',
    '1644': 'Transfer Press M/c',
    '1701': 'Abbresive',
    '1702': 'Bearings',
    '1703': 'Belts',
    '1704': 'Building & Repairing',
    '1705': 'Chemicals',
    '1706': 'Fuses',
    '1707': 'Gear and Coupling',
    '1708': 'General Store',
    '1709': 'Graphite',
    '1710': 'Hand Tools',
    '1711': 'House Keeping',
    '1712': 'Lubricants',
    '1713': 'Lung & Glands',
    '1714': 'Nut & Bolts',
    '1715': 'Packing Items',
    '1716': 'Paints & Brushes',
    '1717': 'Pipe & Fettings',
    '1718': 'QC Lab Chemical',
    '1719': 'QC Consumables',
    '1720': 'Safety Items',
    '1721': 'Seal & O rings',
    '1722': 'SS Material',
    '1723': 'Stationary Items',
    '1724': 'Switch Gears',
    '1725': 'Welding Material',
    '1726': 'Wire & Cable New',
    '1727': 'Job Work Material',
    '1728': 'Elec Measuring Inst',
    '1729': 'Elec General Item',
    '1730': 'Automation',
    '1731': 'Ca Brush & Holder',
    '1732': 'Switch & Socket',
    '1733': 'DO NOT USE',
    '1734': 'Process Instruments',
    '1735': 'Slitting Consumables',
    '1736': 'Cutter & Blades',
    '1737': 'Coil Comsumables',
    '1738': 'Lifting Tackles',
    '1739': 'Ceramics Consumables',
    '1740': 'Admin & HR',
    '1741': 'CCP Miscellaneous',
    '1742': 'Craft Consumables',
    '1743': 'CUP Consumables',
    '1744': 'Dross Consumables',
    '1745': 'Druid Consumables',
    '1746': 'Electrical Gen Items',
    '1747': 'Fluxes',
    '1748': 'Fuel',
    '1749': 'Gases',
    '1750': 'IT Consumable',
    '1751': 'Lighting',
    '1752': 'Maintenance Gen Item',
    '1753': 'Medal Consumable',
    '1754': 'Medicine',
    '1755': 'N2 Plant Consumable',
    '1756': 'Refractories',
    '1757': 'Copper Mat Store',
    '1758': 'Insulation',
    '1759': 'Medal Electrical Ite',
    '1801': 'PVC Miscel.Scrap',
    '1802': 'Wooden Scrap',
    '1803': 'M.S Scrap',
    '1804': 'S.S Scrap',
    '1805': 'Stone Scrap',
    '1806': 'Electric Scrap',
    '1807': 'Packing Scrap',
    '1808': 'Production Metal Scp',
    '1809': 'Plastic SCrap',
    '1901': 'Capital & Asset',
    '2001': 'Legal & Professional',
    '2002': 'Engg.& Consultancy',
    '2003': 'Painting Contractor',
    '2004': 'Fabrication Contract',
    '2005': 'M/c Maint & Service',
    '2006': 'Building Repairing',
    '2007': 'Civil Contractors',
    '2008': 'Labour Contractors',
    '2009': 'Others',
    '2101': 'Cup Steel punches',
    '2102': 'Carbide',
    '2103': 'Cup Die Cage Spare',
    '2104': 'Cup Steel Dies',
    '2105': 'Case Steel Tooling',
    '2106': 'Coin Master Tools',
    '2107': 'Coin Die Cage Spare',
    '2108': 'Coin Master Steel To',
    'A001': 'On Account Billed',
    'A002': 'On Account Utilized',
    'ALBR': 'ALBR',
    'ALUMINIUM': 'ALUMINIUM',
    'B001': 'One Time Credit',
    'B002': 'Cloud Revenue',
    'BR05': 'BRASS 95/05',
    'BR08': 'BRASS 92/08',
    'BR10': 'BRASS 90/10',
    'BR28': 'BRASS 72/28',
    'BR30': 'BRASS 70/30',
    'BR35': 'BRASS 65/35',
    'BR37': 'BRASS 63/37',
    'CHANNAL': 'CHANNAL',
    'CHANNEL': 'CHANNEL',
    'CN05': 'CN 95/05',
    'CN08': 'CN 92/08',
    'CN10': 'CN 90/10',
    'CN15': 'CN 85/15',
    'CN20': 'CN 80/20',
    'CN21': 'CN 79/21',
    'CN25': 'CN 75/25',
    'CN27': 'CN 73/27',
    'CN3.75': 'CN 96.25/3.75',
    'CN30': 'CN 70/30',
    'COPPER': 'COPPER',
    'E001': 'Accommodation',
    'E002': 'Airfare',
    'E003': 'Ground Transp.',
    'E004': 'Travel Expenses misc',
    'HONEY': 'HONEY',
    'L001': 'Trading Materials',
    'L002': 'Raw Materials',
    'L003': 'Semi-Finished Goods',
    'L004': 'Finished Goods',
    'L005': 'Unvaluated Materials',
    'L006': 'Returnable Packaging',
    'L007': 'Licenses',
    'L008': 'Hardware',
    'MIX-ALLOY': 'MIX ALLOY',
    'MN-METAL': 'MN METAL',
    'MONAL': 'MONAL',
    'MONEL': 'MONEL',
    'N-GOLD': 'SN 89/5/5/1',
    'NGOLD': 'NGOLD',
    'NICKLE': 'NICKLE',
    'NS02': 'NS 63/02/35',
    'NS04': 'NS 81/04/15',
    'NS05': 'NS 75/05/20',
    'NS06': 'NS 70/5.5/24.5',
    'NS09': 'NS 64/09/27',
    'NS10': 'NS 65/10/25',
    'NS12': 'NS 59/12/29',
    'NS12.5': 'NS 65/12.5/22.5',
    'NS15': 'NS 75/15/10',
    'NS18': 'NS 65/18/17',
    'NS18.': 'NS 62/18/20',
    'NS18*': 'NS 55/18/27',
    'NS20': 'NS 65/20/15',
    'NS22': 'NS 64/22/14',
    'NS3.8': 'NS 75.8/3.8/20.8',
    'NS4.1': 'NS 64/04/32',
    'P000': 'Contract Type',
    'P001': 'Services',
    'P002': 'Expenses',
    'P003': 'Periodic Service',
    'PHOSPORUS': 'PHOSPHORUS',
    'PHOSPOURS': 'PHOSPOURS',
    'RS10': 'RS10',
    'RS20': 'RS20',
    'RS5': 'NS 75/05/20',
    'SILVER': 'SILVER',
    'SN01': 'SN 89/5/5/1',
    'TIN': 'TIN',
    'YBFA01': 'Real Estate (Land)',
    'YBFA02': 'Buildings',
    'YBFA03': 'Land Improvements',
    'YBFA04': 'Leasehold Improvemen',
    'YBFA05': 'Machinery Equipment',
    'YBFA06': 'Fixtures Fittings',
    'YBFA07': 'Vehicles',
    'YBFA08': 'Computer Hardware',
    'YBFA09': 'Computer Software',
    'YBFA10': 'Low Value Assets',
    'YBFA11': 'Other Intangibles',
    'YBFA12': 'Office Equipment',
    'YBMM00': 'Non-Sto Mat. w.o ID',
    'YBMM01': 'Non-Sto Mat. w. ID',
    'YBPM01': 'Spare parts',
    'YBPM02': 'Spare parts services',
    'ZINC': 'ZINC',
}

# SAP user ID -> [full name (First + Last Name), User Name], copied from the SAP user list. The page shows the full name;
# an ID that is not listed here (and department users such as 'MRP Controll') is shown as it is.
USER_NAMES = {
    'CB9980000000': ['Admin MG', 'ADMINMG'],
    'CB9980000002': ['Ketan Hire', 'MM_CUTOVER'],
    'CB9980000010': ['Urmila Badsiwal', 'SD_CUTOVER'],
    'CB9980000011': ['Dharma Teja', 'PM_CUTOVER'],
    'CB9980000012': ['Rakesh Singh', 'CO_CUTOVER'],
    'CB9980000015': ['Aditiya Vora', 'ABAP_CUTOVER'],
    'CB9980000020': ['GS Pathak', 'GSPATHAK'],
    'CB9980000021': ['Hemant Patidar', 'HEMANT'],
    'CB9980000022': ['Jitendra Mandloi', 'JITENDRA'],
    'CB9980000023': ['Piyush Barve', 'PIYUSH'],
    'CB9980000024': ['Udaynarayan Choubey', 'UNCHOUBEY'],
    'CB9980000025': ['Pushpendra Singh Chouhan', 'PUSHPENDRASINGH'],
    'CB9980000026': ['Vijay Raj Singh Panwar', 'VIJAYRAJ'],
    'CB9980000027': ['Head Mech Maint', 'HEAD_MECH_MAINT'],
    'CB9980000028': ['Anshul Sharwad', 'ANSHULS'],
    'CB9980000029': ['Nilesh Jain', 'NILESH'],
    'CB9980000030': ['Prashant Garg', 'PRASHANT'],
    'CB9980000031': ['Deepak Mulewa', 'DEEPAK'],
    'CB9980000032': ['Mukesh Kumar Matka', 'MUKESH'],
    'CB9980000033': ['Yogesh Kumar Sharma', 'YOGESH'],
    'CB9980000034': ['Raj Babu Dangi', 'RAJ'],
    'CB9980000035': ['Omprakash Sahu', 'OMPRAKASH'],
    'CB9980000036': ['Vikas Yadav', 'VIKAS'],
    'CB9980000037': ['Narendra Birle', 'NARENDRA'],
    'CB9980000038': ['Surya Karma', 'SURYA'],
    'CB9980000039': ['Haresh Mayekar', 'HARESH'],
    'CB9980000040': ['Pratosh Yadav', 'PRATOSH'],
    'CB9980000042': ['Pawan Sharma', 'PAWAN'],
    'CB9980000043': ['Case Toolroom MG', 'CASE_TOOLROOM'],
    'CB9980000044': ['Neeraj Sharma', 'NEERAJ'],
    'CB9980000045': ['Case Production', 'CASE_PRD'],
    'CB9980000046': ['Kamal Soianki', 'KAMALS'],
    'CB9980000047': ['Rahul Yadav', 'RAHUL'],
    'CB9980000049': ['Case QC', 'CASEQC'],
    'CB9980000050': ['Nitesh Jain', 'NITESH2'],
    'CB9980000051': ['Vikram Baid', 'VIKRAM'],
    'CB9980000052': ['Sunil Sharma', 'SUNILS'],
    'CB9980000054': ['Kamal Jain', 'KAMAL'],
    'CB9980000056': ['Pramod Kumar', 'PRAMOD'],
    'CB9980000057': ['Amit Kapoor', 'AMIT'],
    'CB9980000058': ['Nitesh Jain', 'NITESH1'],
    'CB9980000059': ['Sunil Maheswari', 'SUNIL'],
    'CB9980000060': ['Ranjan Thakur', 'RANJAN'],
    'CB9980000061': ['Aakash Singhai', 'AAKASH'],
    'CB9980000062': ['Vipin Jain', 'VIPIN'],
    'CB9980000063': ['Anshul Mittal', 'ANSHULM'],
    'CB9980000064': ['Ankit Mittal', 'ANKIT'],
    'CB9980000065': ['Mukesh Satankar', 'MUKESHS'],
    'CB9980000066': ['Praveen CK', 'PRAVEEN'],
    'CB9980000067': ['Rafiq Khan', 'RAFIQ'],
    'CB9980000068': ['Sunil Patel', 'SUNILP'],
    'CB9980000069': ['Ajay Jaiswal', 'AJAY'],
    'CB9980000070': ['Vineeth Krishna', 'VINEETH'],
    'CB9980000071': ['Rajkumar Dhote', 'RAJKUMAR'],
    'CB9980000080': ['Anil Puttala', 'ANILP'],
    'CB9980000081': ['Hemant Rout', 'HEMANTR'],
    'CB9980000082': ['PMO MG', 'PMO_MG'],
    'CB9980000083': ['Harish Pandey', 'SECURITYSUP'],
    'CB9980000084': ['Vinod Verma', 'MEDALPRD'],
    'CB9980000085': ['Arun Chouhan', 'MEDALQC'],
    'CB9980000087': ['Head HR', 'HEAD_HR'],
    'CB9980000088': ['Cup QC', 'CUPQC'],
    'CB9980000089': ['Gyanendra Mishra', 'COINQC'],
    'CB9980000091': ['Coil Quality', 'COILQC'],
    'CB9980000092': ['Arun Singh', 'ARUN'],
    'CB9980000093': ['Nipendra Jha', 'NIPENDRA'],
    'CB9980000100': ['Manoj Bhargav', 'MBHARGAV'],
    'CB9980000101': ['Pavan Sharma', 'PAVANHO'],
    'CB9980000317': ['Manoj Bhandari', 'MBHANDARI'],
    'CB9980000498': ['Sangeeta Mahajan', 'SANGEETA'],
    'CB9980000499': ['PMO MG', 'PMO'],
    'CB9980000509': ['Mohammad Arif', 'MOHAMMAD'],
    'CB9980000516': ['Shashank Sahu', 'SHASHANK'],
    'CB9980000517': ['Anubhav Choudhary', 'ANUBHAV'],
    'CB9980000521': ['Chetan Verma', 'CHETAN'],
    'CB9980000522': ['Virendra Lodhi', 'VIRENDRA'],
    'CB9980000582': ['Quaid Johar', 'QUAID'],
    'CB9980000726': ['Arvind Kumar Sharma', 'ARVIND'],
    'CB9980000742': ['Vishal Kumar', 'VISHAL_KUMAR'],
    'CB9980000743': ['Aman Karma', 'AMAN_KARMA'],
    'CB9980000744': ['Vishal Bhairam', 'VISHAL_BHAIRAM'],
    'CB9980000745': ['Nitesh Ahirwal', 'NITESH_AHIRWAL'],
    'CB9980000746': ['Sumit Verma', 'SUMIT_VERMA'],
    'CB9980000747': ['Abhinendra Kushwaha', 'ABHINENDRA_KUSHWAHA'],
    'CB9980000749': ['Murlidhar Lovevanshi', 'MURLIDHAR_LOVEVANSHI'],
    'CB9980000751': ['Satyam Kumar Pandey', 'SATYAM_PANDEY'],
    'CB9980000752': ['Vikas Ghatare', 'VIKAS_GHATARE'],
    'CB9980000754': ['Praveen Siriya', 'PRAVEEN_SIRIYA'],
    'CB9980000755': ['Sandeep Kumar Singh', 'SANDEEP_SINGH'],
    'CB9980000757': ['Nitesh Kauraik', 'NITESH_KAURAIK'],
    'CB9980000758': ['Suresh Singh Devda', 'SURESH_DEVDA'],
    'CB9980000763': ['Vikramjeet Singh', 'VIKRAMJEET_SINGH'],
    'CB9980000764': ['Vikas Rathore', 'VIKAS_RATHORE'],
    'CB9980000765': ['Satyam Mishra', 'SATYAM_MISHRA'],
    'CB9980000882': ['Narendra Yadav', 'NARENDRA_YADAV'],
    'CB9980000890': ['Narendra Shukla', 'NARENDRA_SHUKLA'],
    'CB9980000891': ['Dayaram Mulye', 'DAYARAM_MULYE'],
    'CB9980001231': ['Somnath Shikare', 'SOMNATH'],
    'CB9980001300': ['Shailesh Saini', 'SHAILESH'],
    'CB9980001330': ['Chandra Pratap', 'CHANDRA'],
    'CB9980001332': ['Abhay Sant', 'ABHAY'],
    'CB9980001338': ['Narendra Dangaya', 'NARENDRA_DANGAYA'],
    'CB9980001342': ['Shyam Puri', 'SHYAM'],
    'CB9980001344': ['Avadhesh Kumar', 'AVADHESH'],
    'CB9980001346': ['Vijar Kumar Sharma', 'VIJAY_SHARMA'],
    'CB9980001356': ['Shreekrishn Ji', 'SHREEKRISHN'],
}


def _day(s):
    m = re.match(r'/Date\((-?\d+)', s or '')
    return int(m.group(1)) // 86400000 if m else None


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def to_compact(rows, asof_day):
    dicts = {k: {} for k in ('plants', 'slocs', 'pgs', 'types', 'units', 'users', 'reqs')}

    def code(name, value):
        d = dicts[name]
        if value not in d:
            d[value] = len(d)
        return d[value]

    out = []
    for r in rows:
        req, ordq = _f(r.get('RequestedQuantity')), _f(r.get('OrderedQuantity'))
        out.append([
            r.get('PurchaseRequisition') or '',
            r.get('PurchaseRequisitionItem') or '0',
            code('plants', r.get('Plant') or '(blank)'),
            code('slocs', r.get('StorageLocation') or '(blank)'),
            code('pgs', r.get('PurchasingGroup') or '(blank)'),
            code('types', r.get('PurchaseRequisitionType') or '(blank)'),
            (r.get('Material') or '').lstrip('0'),
            (r.get('PurchaseRequisitionItemText') or '').strip(),
            round(req, 3),
            round(max(req - ordq, 0), 3),
            code('units', r.get('BaseUnit_1') or ''),
            round(_f(r.get('ItemNetAmount')), 2),
            # PurReqCreationDate is the India date that ME5A shows as requisition date; PurchaseReqnCreationDate
            # is the UTC date, a day early for PRs created after 18:30 UTC (the night MRP run).
            _day(r.get('PurReqCreationDate') or r.get('PurchaseReqnCreationDate')),
            _day(r.get('DeliveryDate')),
            _ST.get(r.get('ProcessingStatus'), 0),
            1 if r.get('IsClosed') in (True, 'true', 'True') else 0,
            code('users', r.get('CreatedByUser') or '(blank)'),
            r.get('PurchasingDocument') or '',
            code('reqs', (r.get('RequisitionerName') or '').strip() or '(blank)'),
            _day(r.get('PurchaseRequisitionReleaseDate')),
        ])
    data = {'asofDay': asof_day, 'rows': out}
    for k, d in dicts.items():
        data[k] = list(d.keys())
    return data


def po_compact(rows, asof_day, status_rows=()):
    """Rows (one per PO item): [creationDay, poDay, po, item, type, supplier, plant, sloc, material, itemText, materialGroup,
    materialType, createdBy, unit, currency, qty, price, amount, flags, purchGroup, purchOrg, procState, deliveredQty, toDeliverQty].
    flags: 1 release not completed. Delivered and to-deliver quantity come from the status view (null when it has no row).
    Supplier entries are [id, name, GSTIN]. Amount and price are in the document currency."""
    dicts = {k: {} for k in ('types', 'plants', 'slocs', 'mats', 'texts', 'groups', 'mtypes', 'users', 'units', 'curs', 'pgs', 'orgs', 'procs')}
    sup_idx, sup_list = {}, []

    def code(name, value):
        d = dicts[name]
        if value not in d:
            d[value] = len(d)
        return d[value]

    def yes(v):
        return v in (True, 'true', 'True')

    status = {(x.get('PurchaseOrder'), x.get('PurchaseOrderItem')): (round(_f(x.get('GoodsReceiptQty')), 3),
                                                                      round(_f(x.get('StillToBeDeliveredQuantity')), 3))
              for x in status_rows}
    out, seen = [], set()
    for r in rows:
        key = (r.get('PurchaseOrder'), r.get('PurchaseOrderItem'))
        if key in seen:
            continue
        seen.add(key)
        sid = (r.get('Supplier') or '').lstrip('0') or '(blank)'
        qty, amt = round(_f(r.get('OrderQuantity')), 3), round(_f(r.get('NetAmount')), 2)
        got = status.get(key) or (None, None)
        if got[0] is not None and got[0] < 0 and qty > 0:
            # a returns item: SAP shows it with a negative quantity and value, the view with a positive one (its receipt is negative)
            qty, amt = -qty, -amt
        if sid not in sup_idx:
            sup_idx[sid] = len(sup_list)
            sup_list.append([sid, (r.get('SupplierName') or '').strip(), (r.get('TaxNumber3') or '').strip()])
        out.append([
            _day(r.get('CreationDate')),
            _day(r.get('PurchaseOrderDate')),
            r.get('PurchaseOrder') or '',
            int(r.get('PurchaseOrderItem') or 0),
            code('types', r.get('PurchaseOrderType') or '(blank)'),
            sup_idx[sid],
            code('plants', r.get('Plant') or '(blank)'),
            code('slocs', r.get('StorageLocation') or ''),
            code('mats', (r.get('Material') or '').lstrip('0')),
            code('texts', (r.get('PurchaseOrderItemText') or '').strip()),
            code('groups', r.get('MaterialGroup') or '(blank)'),
            code('mtypes', r.get('MaterialType') or ''),
            code('users', r.get('CreatedByUser') or ''),
            code('units', r.get('PurchaseOrderQuantityUnit') or ''),
            code('curs', r.get('DocumentCurrency') or ''),
            qty,
            round(_f(r.get('NetPriceAmount')), 2),
            amt,
            1 if yes(r.get('ReleaseIsNotCompleted')) else 0,
            code('pgs', r.get('PurchasingGroup') or ''),
            code('orgs', r.get('PurchasingOrganization') or ''),
            code('procs', r.get('PurchasingProcessingStatus') or ''),
            *got,
        ])
    data = {'asofDay': asof_day, 'rows': out, 'suppliers': sup_list}
    for k, d in dicts.items():
        data[k] = list(d.keys())
    return data


def consume_fold(state, rows):
    """Reads the goods issue rows page by page (the rows are not kept: there are several hundred thousand) and keeps the last day of
    consumption per (plant, material) as {(plant, material): day}."""
    state = {} if state is None else state
    for r in rows:
        d = _day(r.get('PostingDate'))
        if d is not None and r.get('GoodsMovementType_1') in CONSUME_MVTS and _f(r.get('QuantityInBaseUnit')) > 0:
            key = ((r.get('Plant') or ''), (r.get('Material') or '').lstrip('0'))
            if d > state.get(key, 0):
                state[key] = d
    return state


def _day_of_iso(s):
    y, m, d = (int(x) for x in s.split('-'))
    return (date(y, m, d) - date(1970, 1, 1)).days


def stock_compact(rows, asof_day, allowed=None, last=None):
    """Only rows that hold stock (quantity or value not 0). Row: [product, plant, sloc, materialGroup, productType, stockType, specialStock,
    unit, quantity, value, kind, lastConsumedDay (0 = none since 1 Jan 2026)]; products are [id, name], storage locations [code, name]. Value is in INR.
    allowed: {(plant, storage location): (type, name)} to keep (stock_locations.csv, type Store / Internal Plant material); None keeps every location."""
    dicts = {k: {} for k in ('plants', 'groups', 'ptypes', 'stypes', 'sps', 'units', 'kinds')}
    prods, slocs = {}, {}

    def code(name, value):
        d = dicts[name]
        if value not in d:
            d[value] = len(d)
        return d[value]

    last_map = last or {}  # last consumption day per (plant, material), see consume_fold

    out = []
    for r in rows:
        qty, val = _f(r.get('MatlWrhsStkQtyInMatlBaseUnit')), _f(r.get('StockValueInDisplayCurrency'))
        if qty == 0 and val == 0:
            continue
        kind = ''
        if allowed is not None:
            info = allowed.get(((r.get('Plant') or ''), (r.get('StorageLocation') or '')))
            if info is None:
                continue
            kind = info[0]
        pid = (r.get('Product') or '').lstrip('0') or '(blank)'
        if pid not in prods:
            prods[pid] = [len(prods), (r.get('ProductName') or '').strip()]
        sk = ((r.get('StorageLocation') or ''), (r.get('StorageLocationName') or '').strip())
        if sk not in slocs:
            slocs[sk] = len(slocs)
        out.append([
            prods[pid][0],
            code('plants', r.get('Plant') or '(blank)'),
            slocs[sk],
            code('groups', r.get('ProductGroup') or ''),
            code('ptypes', r.get('ProductType') or ''),
            code('stypes', r.get('InventoryStockType') or ''),
            code('sps', r.get('InventorySpecialStockType') or ''),
            code('units', r.get('MaterialBaseUnit') or ''),
            round(qty, 3),
            round(val, 2),
            code('kinds', kind),
            last_map.get(((r.get('Plant') or ''), pid), 0),
        ])
    data = {'asofDay': asof_day, 'rows': out, 'onlyListed': allowed is not None, 'listedCount': len(allowed) if allowed is not None else 0,
            'listed': sorted([p, c, v[1], v[0]] for (p, c), v in allowed.items()) if allowed is not None else [],
            'issuesRead': last is not None, 'issuesFrom': _day_of_iso(re.search(r"datetime'(\d{4}-\d\d-\d\d)", ISSUE_DATE_FILTER).group(1)),
            'prods': [[pid, v[1]] for pid, v in sorted(prods.items(), key=lambda kv: kv[1][0])],
            'slocs': [[k[0], k[1]] for k, _ in sorted(slocs.items(), key=lambda kv: kv[1])]}
    for k, d in dicts.items():
        data[k] = list(d.keys())
    return data


def issue_compact(rows, asof_day):
    """Rows: [day, costCenter, plant, sloc, material, qty, unit, value, movementType, postedBy, reservation, matDoc, reservationBy,
    department, basis]. Basis: 1 machine list, 2 department code of the cost center, 3 plant-common function, 4 reservation creator
    is in the user's list, 5 creator's usual department (inferred from the creator's other issues), 6 not assigned.
    Quantity and value are positive for an issue (stock out, H) and negative for its reversal (S)."""
    dicts = {k: {} for k in ('ccs', 'plants', 'slocs', 'mats', 'units', 'mvts', 'users', 'depts')}

    def code(name, value):
        d = dicts[name]
        if value not in d:
            d[value] = len(d)
        return d[value]

    prep = []
    seen = {}  # reservation creator -> department -> lines, counted on cost center based departments only (basis 1 and 2)
    for r in rows:
        if r.get('GoodsMovementType_1') not in ISSUE_MVTS:
            continue
        cc = r.get('CostCenter') or r.get('CostCenter_1') or ''
        dept, basis, ccname = cc_info(cc)
        res_user = r.get('UserID') or ''
        if dept and basis in (1, 2) and res_user:
            u = seen.setdefault(res_user, {})
            u[dept] = u.get(dept, 0) + 1
        prep.append((r, cc, dept, basis, ccname, res_user))

    # a creator's usual department: at least 20 lines and at least 75% of them in one department
    usual = {}
    for u, c in seen.items():
        tot = sum(c.values())
        top = max(c, key=c.get)
        if tot >= 20 and c[top] / tot >= 0.75:
            usual[u] = top

    out = []
    for r, cc, dept, basis, ccname, res_user in prep:
        if not dept and USER_DEPT.get(res_user):
            dept, basis = USER_DEPT[res_user], 4
        if not dept and usual.get(res_user):
            dept, basis = usual[res_user], 5
        if not dept:
            dept, basis = 'Unassigned', 6
        sign = 1 if r.get('DebitCreditCode') == 'H' else -1
        name = ccname or (r.get('CostCenterName') or '').strip()  # a machine-list cost center gets its readable name from the lists
        mat = (r.get('Material') or '').lstrip('0')
        out.append([
            _day(r.get('PostingDate')),
            code('ccs', f'{name} ({cc})' if name and cc else name or cc or '(blank)'),
            code('plants', r.get('Plant') or '(blank)'),
            code('slocs', r.get('StorageLocation') or '(blank)'),
            code('mats', f"{mat} · {(r.get('ProductName') or '').strip()}" if mat else '(blank)'),
            round(sign * _f(r.get('QuantityInBaseUnit')), 3),
            code('units', r.get('MaterialBaseUnit') or ''),
            round(sign * _f(r.get('TotalGoodsMvtAmtInCCCrcy')), 2),
            code('mvts', r.get('GoodsMovementType_1') or ''),
            code('users', r.get('CreatedByUser') or ''),
            (r.get('Reservation') or '').lstrip('0'),
            r.get('MaterialDocument') or '',
            code('users', res_user),
            code('depts', dept),
            basis,
        ])
    data = {'asofDay': asof_day, 'rows': out}
    for k, d in dicts.items():
        data[k] = list(d.keys())
    return data


# ---------------------------------------------------------------------------------------------------------------------
# Store issue "Department". A cost center is either a machine (base, ends in 00) or one of its 40 child cost centers
# (base + 60 .. base + 99; the last two digits say the cost type, see CATS). The machine lists below are the department
# tables the user sent on 16-Oct-2026. Machines in the cost center master that are not in those tables are listed with
# department '?' (not given yet).
# ---------------------------------------------------------------------------------------------------------------------
RAW = """
Case|Coin_Master_17|CM-17|1010136300
Case|Coin_Master_16|CM-16|1010136400
Case|Coin_Master_15|CM-15|1010136500
Case|Coin_Master_14|CM-14|1010136600
Case|Coin_Master_13|CM-13|1010136700
Case|Coin_Master_11|CM-11|1010136800
Case|Coin_Master_10|CM-10|1010136900
Case|Coin_Master_08|CM-08|1010137000
Case|Coin_Master_07|CM-07|1010137100
Case|Coin_Master_04|CM-04|1010137200
Case|Coin_Master_03|CM-03|1010137300
Case|Case_Packing|P-CASE|1010251200
Case|Spm_26|SPM-26|1010251400
Case|Spm_25|SPM-25|1010251500
Case|Spm_24|SPM-24|1010251600
Case|Spm_23|SPM-23|1010251700
Case|Spm_22|SPM-22|1010251800
Case|Spm_21|SPM-21|1010251900
Case|Spm_20|SPM-20|1010252000
Case|Spm_19|SPM-19|1010252100
Case|Spm_18|SPM-18|1010252200
Case|Spm_17|SPM-17|1010252300
Case|Spm_16|SPM-16|1010252400
Case|Spm_15|SPM-15|1010252500
Case|Spm_14|SPM-14|1010252600
Case|Spm_13|SPM-13|1010252700
Case|Spm_12|SPM-12|1010252800
Case|Spm_11|SPM-11|1010252900
Case|Spm_10|SPM-10|1010253000
Case|Spm_09|SPM-9|1010253100
Case|Spm_08|SPM-8|1010253200
Case|Spm_07|SPM-7|1010253300
Case|Spm_06|SPM-6|1010253400
Case|Spm_05|SPM-5|1010253500
Case|Spm_04|SPM-4|1010253600
Case|Spm_03|SPM-3|1010253700
Case|Spm_02|SPM-2|1010253800
Case|Spm_01|SPM-1|1010253900
Case|Tip_Annealing_01|TIP ANN1|1010254000
Case|Coin_Master_12|CM-12|1010254200
Case|Coin_Master_09|CM-09|1010254300
Case|Coin_Master_06|CM-06|1010254400
Case|Coin_Master_05|CM-05|1010254500
Case|Coin_Master_02|CM-02|1010254600
Case|Coin_Master_01|CM-01|1010254700
Case|Sr_Annealing_05|SR ANN-5|1010254800
Case|Sr_Annealing_04|SR ANN-4|1010254900
Case|Sr_Annealing_03|SR ANN-3|1010255000
Case|Sr_Annealing_02|SR ANN-2|1010255100
Case|Sr_Annealing_01|SR ANN-1|1010255200
Case|Vision_Machine_01|VISION-1|1010255300
Case|Polishing_Bowl_09|PBOWL-09|1010255400
Case|Polishing_Bowl_08|PBOWL-08|1010255500
Case|Polishing_Bowl_07|PBOWL-07|1010255600
Case|Polishing_Bowl_06|PBOWL-06|1010255700
Case|Bell_Annealing_12_Mt|BA12|1010255800
Case|Press_03_304|304PRS-3|1010255900
Case|Press_02_304|304PRS-2|1010256000
Case|Press_01_304|304PRS-1|1010256100
Case|Duplex_Press_02_Head_02|DPX-2H2|1010256200
Case|Duplex_Press_02_Head_01|DPX-2H1|1010256300
Case|Duplex_Press_01_Head_02|DPX-1H2|1010256400
Case|Duplex_Press_01_Head_01|DPX-1H1|1010256500
Case|Spm_Ludhiyana|SPM-LU|1010251300
CCP|Pulverizer|PULVER|2010118500
CCP|Milling_Machine|MILLING|2010118600
CCP|Ccp_07|CCP-07|2010118700
CCP|Ccp_06|CCP-06|2010118800
CCP|Ccp_05|CCP-05|2010118900
CCP|Ccp_04|CCP-04|2010119000
CCP|Holding_Furnace_07|HF-07|2010119100
CCP|Holding_Furnace_06|HF-06|2010119200
CCP|Holding_Furnace_05|HF-05|2010119300
CCP|Holding_Furnace_04|HF-04|2010119400
CCP|Melting_Furnace_07|MF-07|2010119500
CCP|Melting_Furnace_06|MF-06|2010119600
CCP|Melting_Furnace_05|MF-05|2010119700
CCP|Melting_Furnace_04|MF-04|2010119800
Coil|Slitter_Machine_02|SLITR-02|1010129400
Coil|Coil_Packing|P-COIL|1010129500
Coil|Bell_Annealing_15_Mt|BA15|1010129600
Coil|Loewy_Mill|LOEWY|1010129700
Coil|Lyka_Mill|LYKA|1010129800
Coil|Slitter_Machine_04|SLITR-04|2010127600
Coil|Bell_Annealing_30_Mt_Old|BA30-OLD|2010127700
Coil|Bell_Annealing_30_Mt_New|BA30-NEW|2010127800
Coil|Shear_Machine_02|SHEAR-02|2010127900
Coil|Shear_Machine_01|SHEAR-01|2010128000
Coil|Slitter_Machine_03|SLITR-03|2010128100
Coil|Pickling_Line|PICKLING|2010128200
Coil|Slitter_Machine_01|SLITR-01|2010128300
Coil|Magadh_Mill|MAGADH|2010128400
Coin|Rimming_Machine_08|RIMING-8|1010135700
Coin|Rimming_Machine_07|RIMING-7|1010135800
Coin|Schular_Press_04|SCHULR-4|1010135900
Coin|Coin_Master_20|CM-20|1010136000
Coin|Coin_Master_19|CM-19|1010136100
Coin|Coin_Master_18|CM-18|1010136200
Coin|Coin_Packing|P-COIN|1010137400
Coin|Mrv_04|MRV-4|1010137500
Coin|Mrv_03|MRV-3|1010137600
Coin|Mrv_02|MRV-2|1010137700
Coin|Mrv_01|MRV-1|1010137800
Coin|Rimming_Machine_06|RIMING-6|1010137900
Coin|Rimming_Machine_05|RIMING-5|1010138000
Coin|Rimming_Machine_04|RIMING-4|1010138100
Coin|Rimming_Machine_03|RIMING-3|1010138200
Coin|Rimming_Machine_02|RIMING-2|1010138300
Coin|Rimming_Machine_01|RIMING-1|1010138400
Coin|Schular_Press_03|SCHULR-3|1010138500
Coin|Schular_Press_02|SCHULR-2|1010138600
Coin|Schular_Press_01|SCHULR-1|1010138700
Coin|Polishing_Bowl_05|PBOWL-05|1010138800
Coin|Polishing_Bowl_04|PBOWL-04|1010138900
Coin|Polishing_Bowl_03|PBOWL-03|1010139000
Coin|Bak_Annealing_01|BAK A-01|1010139100
Coin|Mrv_05|MRV-5|1010135600
Coin|Mrv_06|MRV-6|1010135500
Coin|Mrv_07|MRV-7|1010135400
Craft Works (Medal)|Medal_Packing|P-MEDAL|1040389900
Cup|Cupping_Press_08|CP-08|1010159300
Cup|Cupping_Press_07|CP-07|1010159400
Cup|Bak_Annealing_02|BAK A-02|2010156800
Cup|Polishing_Bowl_02|PBOWL-02|2010156900
Cup|Polishing_Bowl_01|PBOWL-01|2010157000
Cup|Cupping_Press_06|CP-06|2010157100
Cup|Cupping_Press_05|CP-05|2010157200
Cup|Cupping_Press_04|CP-04|2010157300
Cup|Cupping_Press_03|CP-03|2010157400
Cup|Cupping_Press_02|CP-02|2010157500
Cup|Cupping_Press_01|CP-01|2010157600
Cup|Cup_Packing|P-CUP|2010156700
Cup|Bak_Annealing_03|BAK A-03|2010156300
Machine Development|Machine_Development|MC-DEV|1010436700
Product Development|New_Product_Development|NP-DEV|1010436600
Project|Project|PROJECT|1010436500
RM|Charge_Preparetion|CHARGE-P|2010359900
RM|Segrigation_Belt|SEG BELT|2010359800
"""
# The same machine short codes also exist in the other plant in the cost center master (same machine, other plant)
EXTRA = """
Cup|Cup_Packing|P-CUP|1010159200
RM|Segrigation_Belt|SEG BELT|1010359900
Machine Development|Machine_Development|MC-DEV|2010436700
Product Development|New_Product_Development|NP-DEV|2010436600
Project|Project|PROJECT|2010436500
"""
# Machines that are in the cost center master but NOT in the user's department lists (department not given yet)
UNLISTED = """
?|Trub_1|TRUB-1|1010251100
?|Trub_2|TRUB-2|1010251000
?|Trub_3|TRUB-3|1010250900
?|Trub_4|TRUB-4|1010250800
?|Trub_5|TRUB-5|1010250700
?|Projectile_Packing|P-PROJEC|1010289100
?|PR_HD_02|PR-HD-02|1010289200
?|PR_HD_01|PR-HD-01|1010289300
?|PR_KN_01|PR-KN-01|1010289400
?|PR_TP_04|PR-TP-04|1010289500
?|PR_TP_03|PR-TP-03|1010289600
?|PR_TP_02|PR-TP-02|1010289700
?|Lathe_Machine|LATHE|1010289800
?|PR_TR_PS|PR-TR-PS|1010289900
?|Komastu_200_Draw_Press|KOMASTU1|1010436300
?|Automa_180_Transfer_Press|AUTOMA-1|1010436200
?|Osawa_60_Transfer_Press|OSAWA-1|1010436100
?|Pux45_Transfer_Press|PUX45-1|1010436000
?|Mada_60_Transfer_Press|MADA60-1|1010435900
?|Asahi_Seiki_50_Transfer_Press|ASTP50-1|1010435800
?|Deep_Explo_Draw_Press|DEEP EX1|1010435700
?|Deep_Explo_Case_Press|DEEP EX2|1010435600
?|Capital|CAPITAL|1010436400
?|Capital|CAPITAL|2010436400
"""


def parse(txt):
    out = []
    for l in txt.strip().split('\n'):
        d, name, short, base = l.split('|')
        out.append((d, name, short, int(base)))
    return out


M = parse(RAW) + parse(EXTRA) + parse(UNLISTED)
BASES = {b: (d, name, short) for d, name, short, b in M}
assert len(BASES) == len(M), 'duplicate base'

# Cost center = base machine (ends 00) or a child cost center base+60..base+99; the last two digits say the cost type.
CATS = {
    99: ('Store', 'Material handling & water'), 98: ('Store', 'Canteen'), 97: ('Store', 'Capital'), 96: ('Store', 'Production'),
    95: ('Store', 'Packing'), 94: ('Store', 'Tool & die'), 93: ('Store', 'Mechanical maintenance'), 92: ('Store', 'Electrical maintenance'),
    91: ('Store', 'Quality'), 90: ('Store', 'PMO planning'), 89: ('Store', 'Admin / HR / Security'), 88: ('Store', 'Store & purchase'),
    87: ('Store', 'Excise & dispatch'), 86: ('Store', 'Project'), 85: ('Store', 'Machine development'), 84: ('Store', 'New product development'),
    83: ('Power', 'Direct'), 82: ('Power', 'Indirect'),
    81: ('Labour', 'Production'), 80: ('Labour', 'Packing'), 79: ('Labour', 'Tool & die'), 78: ('Labour', 'Mechanical maintenance'),
    77: ('Labour', 'Electrical maintenance'), 76: ('Labour', 'Quality'), 75: ('Labour', 'PMO planning'), 74: ('Labour', 'Admin / HR / Security'),
    73: ('Labour', 'Store & purchase'), 72: ('Labour', 'Excise & dispatch'), 71: ('Labour', 'Project'), 70: ('Labour', 'Machine development'),
    69: ('Labour', 'New product development'), 68: ('Labour', 'House keeping'), 67: ('Labour', 'Conveyance'), 66: ('Labour', 'Hospital & ambulance'),
    65: ('Labour', 'Direct company'), 64: ('Labour', 'Direct contractual'), 63: ('Labour', 'Other administration'), 62: ('Labour', 'Head office'),
    61: ('Labour', 'Cash'), 60: ('Labour', 'Marketing tour'),
}

# Old-style cost centers (for example 2010 11 2001) have no machine. Their department comes from the 2-digit code (digits
# 5-6), which means the same department in every plant in the machine lists above: 12 Coil (both plants), 15 Cup (both),
# 35 RM (both), 13 Coin, 25 Case, 11 CCP, 38 (plant 1040) and 14 Craft Works. Other codes (16, 26, 31, 34, 43 ...) stay open.
CODE_DEPT = {'11': 'CCP', '12': 'Coil', '13': 'Coin', '14': 'Craft Works (Medal)', '15': 'Cup', '16': 'Cup', '25': 'Case',
             '26': 'Case', '35': 'RM', '38': 'Craft Works (Medal)'}

# Code 34 is "plant common" (PLT). Its last two digits say the function, the same in both plants (2010 names: 57 PURCHASE,
# 58 HR, 61 ADMIN, 62 GENERAL INFRA, 63 IT DEPARTMENT, 69 SECURITY, 74 COMP 1 PWR). Mapped to the user's Admin / HR / Security.
PLT_FUNC = {57: ('Admin', 'Purchase'), 58: ('HR', 'HR'), 61: ('Admin', 'Admin'), 62: ('Admin', 'General infra'),
            63: ('Admin', 'IT'), 69: ('Security', 'Security'), 74: ('Admin', 'Compressor power')}

# Department -> users who raise the reservations (the user's list). Used only when the cost center gives no department.
DEPT_USERS = {
    'CCP': ['CB9980000033', 'CB9980000035'],        # Yogesh Sharma, Omprakash Sahu
    'Coil': ['CB9980000037', 'CB9980000038'],       # Narendra Birle, Surya Karma
    'Cup': ['CB9980000746'],                        # Sumit Verma ("Suresh Kort" not found in the user list)
    'Coin': ['CB9980000039', 'CB9980000040'],       # Haresh Mayekar, Pratosh Yadav
    'Case': ['CB9980000044', 'CB9980000045'],       # Neeraj Sharma, Case Production
    'RM': ['CB9980000034'],                         # Raj Babu Dangi
    'HR': ['CB9980000087'],                         # HEAD_HR
    'Case Quality': ['CB9980000049'],               # CASEQC
    'PMO': ['CB9980000499', 'CB9980000082'],        # PMO, PMO_MG
    'Admin': ['CB9980000000'],                      # ADMINMG
    'Security': ['CB9980000083'],                   # SECURITYSUP
    'Coil Quality': ['CB9980000091'],               # COILQC
}
USER_DEPT = {u: dept for dept, users in DEPT_USERS.items() for u in users}


def cc_info(cc):
    """(department or None, basis, readable name) for a cost center ID.
    basis: 1 = machine list (exact), 2 = department code of an old-style cost center (inferred), 3 = plant-common function,
    0 = not a 10-digit ID."""
    if not (cc.isdigit() and len(cc) == 10):
        return None, 0, ''
    n = int(cc)
    base, suf = n // 100 * 100, n % 100
    m = BASES.get(base)
    if m and (suf == 0 or 60 <= suf <= 99):
        dept, mname, short = m
        if suf == 0:
            name = f"{mname.replace('_', ' ')} ({short})"
        else:
            grp, cat = CATS[suf]
            name = f'{short} · {grp} · {cat}'
        return (dept if dept != '?' else None), 1, name
    if cc[4:6] == '34' and n % 100 in PLT_FUNC:
        dept, func = PLT_FUNC[n % 100]
        return dept, 3, f'PLT {cc[:4]} · {func}'
    return CODE_DEPT.get(cc[4:6]), 2, ''
