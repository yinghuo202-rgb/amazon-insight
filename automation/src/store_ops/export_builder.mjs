import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const planPath = process.argv[2];
if (!planPath) throw new Error("缺少导出计划 JSON 路径");
const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
const modulePath = process.env.STORE_OPS_ARTIFACT_TOOL?.trim() || path.join(
  os.homedir(),
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs",
);
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(modulePath).href);

function excelDateSerial(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Math.floor((date.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}

async function loadWorkbook(templatePath) {
  return SpreadsheetFile.importXlsx(await FileBlob.load(templatePath));
}

async function saveWorkbook(workbook, outputPath) {
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
}

async function renderPreview(workbook, sheetName, outputPath) {
  const image = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(outputPath, new Uint8Array(await image.arrayBuffer()));
}

async function buildShipment(document) {
  const workbook = await loadWorkbook(document.templatePath);
  const sheet = workbook.worksheets.getItem("Measureman");
  sheet.freezePanes.freezeRows(32);
  sheet.getRange("A3:B45").clear({ applyTo: "contents" });
  sheet.getRange("D3:N45").clear({ applyTo: "contents" });
  sheet.getRange("P3:P45").clear({ applyTo: "contents" });
  sheet.getRange("R3:R45").clear({ applyTo: "contents" });
  for (let number = 3; number <= 45; number += 1) {
    sheet.getRange(`C${number}`).clear({ applyTo: "contents" });
    sheet.getRange(`Q${number}`).formulas = [[`=IF(OR(P${number}="",K${number}=""),"",P${number}*K${number})`]];
    sheet.getRange(`S${number}`).formulas = [[`=IF(G${number}="","",G${number}/2.54)`]];
    sheet.getRange(`T${number}`).formulas = [[`=IF(H${number}="","",H${number}/2.54)`]];
    sheet.getRange(`U${number}`).formulas = [[`=IF(I${number}="","",I${number}/2.54)`]];
    sheet.getRange(`V${number}`).formulas = [[`=IF(F${number}="","",F${number}/0.45359237)`]];
  }
  sheet.getRange("A1").values = [[document.title]];
  document.rows.forEach((row, index) => {
    const number = index + 3;
    sheet.getRange(`A${number}:B${number}`).values = [[index + 1, row.sku]];
    sheet.getRange(`D${number}:N${number}`).values = [[
      row.cartonQty,
      row.netWeightKg,
      row.grossWeightKg,
      row.lengthCm,
      row.widthCm,
      row.heightCm,
      row.cartonVolumeM3,
      row.quantity,
      row.cartons,
      row.totalWeightKg,
      row.totalVolumeM3,
    ]];
    sheet.getRange(`P${number}`).values = [[row.unitPriceRmb]];
    if (row.imageFormula) sheet.getRange(`C${number}`).formulas = [[row.imageFormula]];
  });
  await saveWorkbook(workbook, document.outputPath);
  if (document.previewPath) await renderPreview(await loadWorkbook(document.outputPath), "Measureman", document.previewPath);
}

async function buildDeclaration(document) {
  const workbook = await loadWorkbook(document.templatePath);
  const sheet = workbook.worksheets.getItem("报关空表");
  const columnName = (number) => {
    let value = number;
    let result = "";
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  };
  const cell = (key, row) => `${columnName(document.columns[key])}${row}`;
  sheet.getRange(`A${document.dataStart}:K${document.dataEnd}`).clear({ applyTo: "contents" });
  sheet.getRange(`M${document.dataStart}:O${document.dataEnd}`).clear({ applyTo: "contents" });
  for (let number = document.dataStart; number <= document.dataEnd; number += 1) {
    const purchaseAmount = cell("purchaseAmountRmb", number);
    const taxRate = cell("taxRate", number);
    sheet.getRange(`L${number}`).formulas = [[`=IF(${purchaseAmount}="","",${purchaseAmount}*${taxRate})`]];
  }
  sheet.getRange("A3").values = [[document.invoiceNumber]];
  sheet.getRange(document.shipmentDateCell).values = [[excelDateSerial(document.shipmentDate)]];
  sheet.getRange("I3").formulas = [["=IFERROR(J3/F3,\"\")"]];
  sheet.getRange("A5").values = [[document.freightReference || ""]];
  sheet.getRange("C5").values = [[document.shippingMarks || ""]];
  sheet.getRange("F5").values = [[document.consignee || ""]];
  sheet.getRange("L5").values = [[document.originPort || "宁波"]];

  document.rows.forEach((row, index) => {
    const number = document.dataStart + index;
    const values = {
      poNumber: row.poNumber,
      factory: row.factory,
      productName: row.productName,
      quantity: row.quantity,
      cartons: row.cartons || null,
      weightKg: row.weightKg || null,
      volumeM3: row.volumeM3 || null,
      purchaseAmountRmb: row.purchaseAmountRmb,
      note: row.note || null,
      taxRate: row.taxRate,
      declarationSku: row.declarationSku,
      unitPriceRmb: row.unitPriceRmb,
    };
    for (const [key, value] of Object.entries(values)) sheet.getRange(cell(key, number)).values = [[value]];
    const quantityCell = cell("quantity", number);
    const unitPriceCell = cell("unitPriceRmb", number);
    sheet.getRange(cell("lineAmountRmb", number)).formulas = [[`=IF(${unitPriceCell}="","",${quantityCell}*${unitPriceCell})`]];
  });
  await saveWorkbook(workbook, document.outputPath);
  if (document.previewPath) await renderPreview(await loadWorkbook(document.outputPath), "报关空表", document.previewPath);
}

for (const shipment of plan.shipments ?? (plan.shipment ? [plan.shipment] : [])) await buildShipment(shipment);
for (const declaration of plan.declarations ?? (plan.declaration ? [plan.declaration] : [])) await buildDeclaration(declaration);
await fs.writeFile(plan.resultPath, JSON.stringify({ status: "completed", files: plan.files }, null, 2), "utf8");
