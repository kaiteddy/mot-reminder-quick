# GA4 Documents / Stock / Suppliers — CSV Export Field Map

Derived from the decoded GA4_Interface (XOR 0x5A). Header label = the CSV column produced by
`Admin → General CSV Exports`. Internal field shown for reference. Strip-prefix already applied.
Run these exports AFTER-HOURS (full export locks GA4 ~1hr).

## Documents (Estimates / Job Sheets / Invoices / Credit Notes)  (`Export_Docs` — 55 cols)

| CSV Column | GA4 internal field |
|---|---|
| Account Held | `custAccountHeld` |
| Account No | `custAccountNumber` |
| Company Name | `custName_Company` |
| Date Created | `docDate_Created` |
| Date Issued | `docDate_Issued` |
| Date Paid | `docDate_Paid` |
| Department | `docDepartment` |
| Doc Type | `docType` |
| DocStatus | `docUserStatus` |
| Fixed Item 1 Gross | `fixedR_Item1GROSS` |
| Fixed Item 1 Net | `fixedR_Item1NET` |
| Fixed Item 1 Tax | `fixedR_Item1TAX` |
| Fixed Item 2 Gross | `fixedR_Item2GROSS` |
| Fixed Item 2 Net | `fixedR_Item2NET` |
| Fixed Item 2 Tax | `fixedR_Item2TAX` |
| Fixed Item 3 Gross | `fixedR_Item3GROSS` |
| Fixed Item 3 Net | `fixedR_Item3NET` |
| Fixed Item 3 Tax | `fixedR_Item3TAX` |
| Forename | `custName_Forename` |
| House No | `custAddress_HouseNo` |
| ID Vehicle | `_ID_Vehicle` |
| Labour Qty | `us_LabourQty` |
| Locality | `custAddress_Locality` |
| MOT Class | `motClass` |
| MOT Cost | `motCost` |
| MOT Outsourced | `motOutsourced` |
| MOT Price | `Price` |
| MOT Status | `motStatus` |
| OrderReference | `docOrderRef` |
| Payment Methods | `ui_display_paymentMethods` |
| Postcode | `custAddress_PostCode` |
| Registration | `vehRegistration` |
| Sub Labour Cost Gross | `us_SubTotal_LabourCostGROSS` |
| Sub Labour Cost Net | `us_SubTotal_LabourCostNET` |
| Sub Labour Cost Tax | `us_SubTotal_LabourCostTAX` |
| Sub Labour Gross | `us_SubTotal_LabourGross` |
| Sub Labour Net | `us_SubTotal_LabourNET` |
| Sub Labour Tax | `us_SubTotal_LabourTAX` |
| Sub MOT Gross | `motSubTotal_GROSS` |
| Sub MOT Net | `motSubTotal_NET` |
| Sub MOT Tax | `motSubTotal_TAX` |
| Sub Parts Cost Gross | `us_SubTotal_PartsCostGross` |
| Sub Parts Cost Net | `us_SubTotal_PartsCostNET` |
| Sub Parts Cost Tax | `us_SubTotal_PartsCostTax` |
| Sub Parts Gross | `us_SubTotal_PartsGross` |
| Sub Parts Net | `us_SubTotal_PartsNET` |
| Sub Parts Tax | `us_SubTotal_PartsTAX` |
| Telephone | `custCont_Telephone` |
| Title | `custName_Title` |
| Total Balance | `us_Balance` |
| Total Gross | `us_TotalGross` |
| Total Net | `us_TotalNET` |
| Total Receipts | `us_TotalReceipts` |
| Total Surcharge | `us_TotalReceipt_Surcharges` |
| Total Tax | `us_TotalTAX` |

## Stock / Inventory  (`Export_Stock` — 33 cols)

| CSV Column | GA4 internal field |
|---|---|
| Barcode No | `itemBarCodeNumber` |
| Cost Net | `itemCostNET` |
| Cost Tax Code | `itemCostTaxCode` |
| Date Last Purchased | `sys_DateLastPurchased` |
| Date Last Sold | `sys_DateLastSold` |
| Description | `itemDescription` |
| Guarantee | `itemGuarantee` |
| ID Supplier | `_ID_Supplier` |
| Location | `itemLocation` |
| Low Stock Level | `itemLowStockLevel` |
| Main Category | `itemCategory` |
| Manufacturer | `itemManufacturer` |
| Markup Retail | `itemMarkupRetail` |
| Markup Trade | `itemMarkupTrade` |
| Min Order Qty | `itemMinOrderQty` |
| Notes | `itemNotes` |
| Part Number | `itemPartNumber` |
| Qty Available | `qtyAvailable` |
| Qty In Stock | `qtyInStock` |
| Qty On Order | `qtyOnOrder` |
| Qty Physically Avail | `qtyToReturn` |
| Qty to Return | `qtyPhysicallyAvailable` |
| Retail Net | `itemPriceRetailNET` |
| Stock Tracking | `itemTracking` |
| Sub Category | `itemCategory2` |
| Supplier Name | `itemSupplier` |
| Trade Net | `itemPriceTradeNET` |
| Tyre Classification | `tyreClassification` |
| Tyre Fuel Economy | `tyreFuelEconomy` |
| Tyre Noise Level | `tyreNoiseLevel` |
| Tyre Noise Level db | `tyreNoiseLevel_db` |
| Tyre Nominal Width | `tyreNominalWidth_Actual` |
| Tyre Wet Grip | `tyreWetGrip` |

## Suppliers  (`Export_Suppliers` — 10 cols)

| CSV Column | GA4 internal field |
|---|---|
| Acc Held | `Account Held` |
| Account No | `Account Number` |
| CR Limit | `Credit Limit` |
| CR Terms | `Credit Terms` |
| Company Name | `Company Name` |
| Email | `Email` |
| Fax | `Fax` |
| Locality | `Address 3` |
| Postcode | `Post Code` |
| Telephone | `Telephone` |
