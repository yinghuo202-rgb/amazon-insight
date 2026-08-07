from __future__ import annotations

import os
import re
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile


_WORKBOOK_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def _worksheet_part(archive: ZipFile, sheet_name: str) -> str:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relation_id = None
    for sheet in workbook.findall(f".//{{{_WORKBOOK_NS}}}sheet"):
        if sheet.attrib.get("name") == sheet_name:
            relation_id = sheet.attrib.get(f"{{{_REL_NS}}}id")
            break
    if not relation_id:
        raise ValueError(f"模板中找不到工作表：{sheet_name}")

    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    target = None
    for relationship in relationships.findall(f"{{{_PACKAGE_REL_NS}}}Relationship"):
        if relationship.attrib.get("Id") == relation_id:
            target = relationship.attrib.get("Target")
            break
    if not target:
        raise ValueError(f"工作表 {sheet_name} 缺少 OOXML 关系")
    normalized = str(PurePosixPath("xl") / target.lstrip("/"))
    return normalized.replace("xl/xl/", "xl/")


def _element_pattern(tag: bytes) -> re.Pattern[bytes]:
    return re.compile(
        rb"<(?:[A-Za-z_][\w.-]*:)?" + tag + rb"\b[^>]*?(?:/>|>.*?</(?:[A-Za-z_][\w.-]*:)?" + tag + rb">)",
        re.DOTALL,
    )


def _main_prefix(xml: bytes) -> bytes:
    match = re.search(rb"<([A-Za-z_][\w.-]*:)?worksheet\b", xml)
    return match.group(1) if match and match.group(1) else b""


def _apply_prefix(fragment: bytes, prefix: bytes) -> bytes:
    if not prefix:
        return fragment
    return re.sub(rb"<(/?)([A-Za-z_][\w.-]*)(\b)", rb"<\1" + prefix + rb"\2\3", fragment)


def _replace_element(source: bytes, target: bytes, tag: bytes, insert_before: bytes | None = None) -> bytes:
    pattern = _element_pattern(tag)
    source_match = pattern.search(source)
    target_match = pattern.search(target)
    if source_match and target_match:
        fragment = _apply_prefix(source_match.group(0), _main_prefix(target))
        return target[: target_match.start()] + fragment + target[target_match.end() :]
    if source_match and insert_before:
        insertion = _element_pattern(insert_before).search(target)
        if insertion:
            fragment = _apply_prefix(source_match.group(0), _main_prefix(target))
            return target[: insertion.start()] + fragment + target[insertion.start() :]
    if not source_match and target_match:
        return target[: target_match.start()] + target[target_match.end() :]
    return target


def _restore_row_opening_tags(source: bytes, target: bytes) -> bytes:
    source_row_pattern = re.compile(rb"<row\b[^>]*>")
    target_row_pattern = re.compile(rb"<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*>")
    row_number_pattern = re.compile(rb'\br="(\d+)"')
    source_rows: dict[bytes, bytes] = {}
    for match in source_row_pattern.finditer(source):
        number = row_number_pattern.search(match.group(0))
        if number:
            source_rows[number.group(1)] = match.group(0)

    def replace(match: re.Match[bytes]) -> bytes:
        number = row_number_pattern.search(match.group(0))
        if not number:
            return match.group(0)
        source_tag = source_rows.get(number.group(1))
        if not source_tag:
            return match.group(0)
        prefix_match = re.match(rb"<([A-Za-z_][\w.-]*:)?row\b", match.group(0))
        prefix = prefix_match.group(1) if prefix_match and prefix_match.group(1) else b""
        return source_tag.replace(b"<row", b"<" + prefix + b"row", 1)

    return target_row_pattern.sub(replace, target)


def restore_layout_metadata(template_path: Path, output_path: Path, sheet_name: str) -> None:
    """Restore exact template-only layout XML after artifact-tool writes business data."""
    handle, temporary_name = tempfile.mkstemp(prefix=output_path.stem + "-", suffix=".xlsx", dir=output_path.parent)
    os.close(handle)
    temporary = Path(temporary_name)
    try:
        with ZipFile(template_path, "r") as template, ZipFile(output_path, "r") as output:
            template_part = _worksheet_part(template, sheet_name)
            output_part = _worksheet_part(output, sheet_name)
            source_xml = template.read(template_part)
            target_xml = output.read(output_part)
            patched_xml = _replace_element(source_xml, target_xml, b"sheetViews", insert_before=b"sheetFormatPr")
            patched_xml = _replace_element(source_xml, patched_xml, b"sheetFormatPr")
            patched_xml = _replace_element(source_xml, patched_xml, b"cols")
            patched_xml = _restore_row_opening_tags(source_xml, patched_xml)
            with ZipFile(temporary, "w", compression=ZIP_DEFLATED) as destination:
                destination.comment = output.comment
                for item in output.infolist():
                    data = patched_xml if item.filename == output_part else output.read(item.filename)
                    destination.writestr(item, data)
        os.replace(temporary, output_path)
    finally:
        temporary.unlink(missing_ok=True)
