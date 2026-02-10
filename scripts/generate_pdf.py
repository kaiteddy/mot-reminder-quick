
import os
import sys
import json
import base64
from templates.invoice_template import generate_invoice
from templates.estimate_template import generate_estimate
from templates.jobsheet_template import generate_job_sheet

def main():
    try:
        # Read JSON data from stdin
        line = sys.stdin.readline()
        if not line:
            return
        
        request = json.loads(line)
        doc_type = request.get('type') # 'invoice', 'estimate', 'jobsheet'
        data = request.get('data')
        output_file = request.get('outputFile', '/tmp/output.pdf')
        
        if doc_type == 'invoice':
            generate_invoice(output_file, data)
        elif doc_type == 'estimate':
            generate_estimate(output_file, data)
        elif doc_type == 'jobsheet':
            generate_job_sheet(output_file, data)
        else:
            print(json.dumps({"error": f"Unknown document type: {doc_type}"}))
            return

        print(json.dumps({"success": True, "path": output_file}))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
