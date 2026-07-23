import pdfplumber
import pandas as pd
import itertools
import re
import os
import pytesseract
from PIL import Image
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfplumber.utils.exceptions import PdfminerException
from utils import parse_date, clean_amount

def detect_columns(df):
    """
    Heuristically detects which column represents dates and which represent numeric/amount columns.
    """
    detected = {
        'date_col': None,
        'numeric_cols': []
    }
    
    if df.empty:
        return detected
        
    columns = df.columns.tolist()
    
    # 1. Detect Date Column
    best_date_col = None
    best_date_score = 0
    
    for col in columns:
        col_lower = col.lower()
        # Sample up to 20 non-empty values
        sample_vals = df[col].dropna().astype(str).tolist()
        sample_vals = [v.strip() for v in sample_vals if v.strip() != ""][:20]
        if not sample_vals:
            continue
            
        parse_success = 0
        for val in sample_vals:
            if parse_date(val) is not None:
                parse_success += 1
                
        score = parse_success / len(sample_vals) if sample_vals else 0
        
        # Boost score if header contains "date"
        if 'date' in col_lower:
            score += 0.3
            
        if score > 0.5 and score > best_date_score:
            best_date_score = score
            best_date_col = col
            
    detected['date_col'] = best_date_col
    
    # 2. Detect Numeric Columns
    # Standard keywords for transaction amounts
    num_keywords = {'debit', 'credit', 'withdrawal', 'deposit', 'balance', 'amount', 'value', 'total', 'transaction'}
    exclude_keywords = {'chq', 'cheque', 'ref', 'number', 'no', 'id', 'date', 'phone', 'acc', 'account', 'desc', 'particulars', 'narration'}
    
    for col in columns:
        if col == best_date_col:
            continue
            
        col_lower = col.lower()
        
        # Skip columns that contain exclude keywords
        if any(ek in col_lower for ek in exclude_keywords):
            continue
            
        is_num_by_header = any(kw in col_lower for kw in num_keywords)
        
        sample_vals = df[col].dropna().astype(str).tolist()
        sample_vals = [v.strip() for v in sample_vals if v.strip() != ""][:20]
        if not sample_vals:
            continue
            
        numeric_success = 0
        for val in sample_vals:
            # Clean and check if float works
            # Remove currency symbols and check if it has digits
            cleaned = re.sub(r'[^\d.]', '', val)
            if cleaned:
                try:
                    float(cleaned)
                    numeric_success += 1
                except ValueError:
                    pass
                    
        score = numeric_success / len(sample_vals) if sample_vals else 0
        
        # If header matches or values look numeric (e.g. > 50% are numeric)
        if is_num_by_header or score > 0.5:
            detected['numeric_cols'].append(col)
            
    return detected

def parse_pdf(pdf_path, password=None):
    """
    Extracts tabular data from all pages of the bank statement PDF and combines them.
    Returns:
        df: pandas DataFrame containing the extracted data
        detected: dict containing detected date and numeric columns
    """
    all_rows = []
    header_cols = None
    header_idx = -1
    
    # Keywords to detect the header row in table data
    keywords = {'date', 'narration', 'description', 'particulars', 'chq', 'cheque', 'ref', 'debit', 'withdrawal', 'credit', 'deposit', 'balance', 'amount'}
    try:
        pdf_obj = pdfplumber.open(pdf_path, password=password)
    except (PDFPasswordIncorrect, PdfminerException) as e:
        is_password_err = False
        if isinstance(e, PDFPasswordIncorrect):
            is_password_err = True
        elif isinstance(e, PdfminerException):
            for arg in e.args:
                if isinstance(arg, PDFPasswordIncorrect) or "PDFPasswordIncorrect" in str(type(arg)):
                    is_password_err = True
                    break
        if is_password_err:
            raise PDFPasswordIncorrect("Password required or incorrect")
        raise
        
    with pdf_obj as pdf:
        for page_num, page in enumerate(pdf.pages):
            # Extract tables using default settings
            tables = page.extract_tables()
            if not tables:
                # Sometimes extract_table works better if extract_tables fails
                table = page.extract_table()
                tables = [table] if table else []
                
            for table in tables:
                if not table or len(table) == 0:
                    continue
                
                # Clean table rows: remove None values and strip spaces
                cleaned_table = []
                for r in table:
                    if r is None:
                        continue
                    cleaned_row = [str(c).strip() if c is not None else "" for c in r]
                    # Only keep row if it's not entirely empty
                    if any(c != "" for c in cleaned_row):
                        cleaned_table.append(cleaned_row)
                        
                if not cleaned_table:
                    continue
                    
                # If we haven't found a header yet, look for it in this table
                if header_cols is None:
                    for idx, row in enumerate(cleaned_table):
                        lower_row = [c.lower() for c in row]
                        # Count matches with header keywords
                        matches = sum(1 for cell in lower_row if any(kw in cell for kw in keywords))
                        if matches >= 2:
                            header_cols = row
                            header_idx = idx
                            break
                    
                    if header_cols is not None:
                        # Slice the table to start after the header
                        data_rows = cleaned_table[header_idx + 1:]
                    else:
                        # Default to first row of first table if keyword search failed
                        header_cols = cleaned_table[0]
                        data_rows = cleaned_table[1:]
                        
                    # Clean header names: handle empty headers and duplicate headers
                    header_cols = [c.strip() if c.strip() else f"Column_{i}" for i, c in enumerate(header_cols)]
                    
                    seen = {}
                    new_headers = []
                    for c in header_cols:
                        if c in seen:
                            seen[c] += 1
                            new_headers.append(f"{c}_{seen[c]}")
                        else:
                            seen[c] = 0
                            new_headers.append(c)
                    header_cols = new_headers
                else:
                    # We already have headers. Extract all data rows, skipping repeating headers.
                    data_rows = []
                    for row in cleaned_table:
                        is_header_repeat = False
                        if len(row) == len(header_cols):
                            # If row contains names identical to headers, skip it
                            match_count = sum(1 for c, h in zip(row, header_cols) if c.lower() == h.lower())
                            if match_count >= max(2, len(header_cols) // 2):
                                is_header_repeat = True
                        if not is_header_repeat:
                            data_rows.append(row)
                            
                # Map data rows to the established header columns
                for row in data_rows:
                    row_dict = {}
                    for h, val in itertools.zip_longest(header_cols, row, fillvalue=""):
                        if h:
                            row_dict[h] = val
                    all_rows.append(row_dict)
                    
    if not all_rows:
        return pd.DataFrame(), {}
        
    df = pd.DataFrame(all_rows)
    
    # Post-processing: Remove rows that look like empty spacer rows (mostly blank)
    # E.g., if more than 80% of cells are empty
    df = df[df.apply(lambda r: sum(str(x).strip() != "" for x in r) / len(r) > 0.2, axis=1)]
    
    # Auto-detect columns
    detected = detect_columns(df)
    
    return df, detected

def parse_image(image_path):
    """
    Performs OCR on the bank statement image and extracts tabular data.
    """
    tesseract_paths = [
        '/opt/homebrew/bin/tesseract',  # Mac Homebrew
        '/usr/bin/tesseract',           # Linux/Docker
        '/usr/local/bin/tesseract'      # Custom install
    ]
    for path in tesseract_paths:
        if os.path.exists(path):
            pytesseract.pytesseract.tesseract_cmd = path
            break

    try:
        img = Image.open(image_path)
        # --psm 6: Assume a single uniform block of text. This is best for OCR-ing tables.
        text = pytesseract.image_to_string(img, config='--psm 6')
    except Exception as e:
        print(f"OCR processing failed: {e}")
        return pd.DataFrame(), {}

    lines = text.split('\n')
    rows = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Try to split by 2 or more spaces to preserve multi-word fields
        parts = [p.strip() for p in re.split(r'\s{2,}', line) if p.strip()]
        if len(parts) > 1:
            rows.append(parts)
            continue
            
        # Fallback: split by single spaces and apply heuristic column grouping
        tokens = line.split()
        if len(tokens) >= 3:
            first_token = tokens[0]
            last_token = tokens[-1]
            cleaned_last = re.sub(r'[^\d.-]', '', last_token)
            
            # Simple check if first token has digits (date-like) and last is numeric (amount-like)
            has_date = any(c.isdigit() for c in first_token)
            try:
                float(cleaned_last)
                has_amount = True
            except ValueError:
                has_amount = False
                
            if has_date and has_amount:
                # Check if second to last token is also numeric (e.g. debit/credit or amount/balance)
                if len(tokens) >= 4:
                    second_to_last = tokens[-2]
                    cleaned_second = re.sub(r'[^\d.-]', '', second_to_last)
                    try:
                        float(cleaned_second)
                        has_second_amount = True
                    except ValueError:
                        has_second_amount = False
                        
                    if has_second_amount:
                        desc = ' '.join(tokens[1:-2])
                        rows.append([first_token, desc, second_to_last, last_token])
                        continue
                
                desc = ' '.join(tokens[1:-1])
                rows.append([first_token, desc, last_token])
                continue
                
        # If no heuristic matched but we have multiple tokens, keep them
        if len(tokens) > 1:
            rows.append(tokens)

    if not rows:
        return pd.DataFrame(), {}

    # Uniform padding of columns to max length
    max_cols = max(len(r) for r in rows)
    padded_rows = []
    for r in rows:
        padded = r + [""] * (max_cols - len(r))
        padded_rows.append(padded)

    # Heuristically find header row in the first few rows
    header_cols = None
    keywords = {'date', 'narration', 'description', 'particulars', 'chq', 'cheque', 'ref', 'debit', 'withdrawal', 'credit', 'deposit', 'balance', 'amount'}
    
    for idx, row in enumerate(padded_rows[:3]):
        lower_row = [c.lower() for c in row]
        matches = sum(1 for cell in lower_row if any(kw in cell for kw in keywords))
        if matches >= 2:
            header_cols = row
            data_rows = padded_rows[idx + 1:]
            break

    if header_cols is None:
        # Default header columns
        header_cols = [f"Column_{i}" for i in range(max_cols)]
        data_rows = padded_rows
    else:
        # Clean headers: handle empty names and make them unique
        header_cols = [c.strip() if c.strip() else f"Column_{i}" for i, c in enumerate(header_cols)]
        seen = {}
        new_headers = []
        for c in header_cols:
            if c in seen:
                seen[c] += 1
                new_headers.append(f"{c}_{seen[c]}")
            else:
                seen[c] = 0
                new_headers.append(c)
        header_cols = new_headers

    all_rows = []
    for row in data_rows:
        row_dict = {}
        for h, val in zip(header_cols, row):
            row_dict[h] = val
        all_rows.append(row_dict)

    df = pd.DataFrame(all_rows)

    # Remove mostly empty spacer rows
    if not df.empty:
        df = df[df.apply(lambda r: sum(str(x).strip() != "" for x in r) / len(r) > 0.2, axis=1)]

    # Run auto-detect
    detected = detect_columns(df)
    return df, detected
