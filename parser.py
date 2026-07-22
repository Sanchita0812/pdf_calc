import pdfplumber
import pandas as pd
import itertools
import re
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

def parse_pdf(pdf_path):
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
    
    with pdfplumber.open(pdf_path) as pdf:
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
