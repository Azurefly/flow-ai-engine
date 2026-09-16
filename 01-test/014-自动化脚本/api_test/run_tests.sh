#!/bin/bash
set -e
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
REPORT_DIR="reports/${TIMESTAMP}"
mkdir -p "${REPORT_DIR}/html"
python3 -m pytest tests/ --tb=short --html="${REPORT_DIR}/html/report.html"
rm -f reports/latest && ln -s "${TIMESTAMP}" reports/latest
echo "测试完成，报告目录: ${REPORT_DIR}"