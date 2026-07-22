import re
import math
from dateutil import parser as date_parser
import pandas as pd

def clean_amount(val):
    """
    Cleans string representing amount and returns a float.
    Handles commas, currency symbols, and spaces.
    Treats blank or invalid values as 0.0.
    Handles negative numbers (e.g. -1250, 1250-, or with Dr/CR indicators).
    """
    if pd.isna(val) or val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    
    val_str = str(val).strip()
    if not val_str:
        return 0.0
    
    # Check for negative indicators
    # Usually debit is represented in its own column without minus, but if there's Dr/Cr/minus:
    is_negative = False
    lower_val = val_str.lower()
    if '-' in val_str or 'dr' in lower_val:
        is_negative = True
        
    # Remove everything except digits and dots
    cleaned = re.sub(r'[^\d.]', '', val_str)
    
    if not cleaned:
        return 0.0
    
    try:
        # Handle cases where multiple dots might occur due to text extraction issues
        if cleaned.count('.') > 1:
            # Keep only the last dot
            parts = cleaned.split('.')
            cleaned = "".join(parts[:-1]) + "." + parts[-1]
            
        amount = float(cleaned)
        return -amount if is_negative else amount
    except ValueError:
        return 0.0

def parse_date(val):
    """
    Parses date strings of various formats into python date objects.
    Uses dateutil.parser with dayfirst=True for standard Indian formatting (DD/MM/YYYY).
    """
    if pd.isna(val) or val is None:
        return None
    
    val_str = str(val).strip()
    if not val_str:
        return None
    
    # Quick check to skip values that are obviously not dates (e.g., headers or balances)
    # If the string contains no numbers, it is likely not a date.
    if not any(char.isdigit() for char in val_str):
        return None
        
    try:
        # Clean up any excessive spaces or characters
        clean_val = re.sub(r'\s+', ' ', val_str)
        # Parse date
        dt = date_parser.parse(clean_val, dayfirst=True)
        return dt.date()
    except (ValueError, TypeError, OverflowError):
        return None

def format_indian_currency(val):
    """
    Formats a numeric value into the Indian numbering system.
    Example: 80179.06 -> ₹80,179.06
             1234567.89 -> ₹12,34,567.89
    """
    if val is None or pd.isna(val):
        return "₹0.00"
    
    is_negative = val < 0
    val = abs(val)
    
    # Format to 2 decimal places
    s = f"{val:.2f}"
    parts = s.split('.')
    integer_part = parts[0]
    decimal_part = parts[1]
    
    n = len(integer_part)
    if n <= 3:
        formatted_int = integer_part
    else:
        # Last 3 digits remain as is
        last_three = integer_part[-3:]
        remaining = integer_part[:-3]
        
        # Group remaining digits by 2 from right to left
        groups = []
        while remaining:
            groups.append(remaining[-2:])
            remaining = remaining[:-2]
        
        # Reverse because we processed right-to-left
        groups.reverse()
        formatted_int = ",".join(groups) + "," + last_three
    
    result = f"₹{formatted_int}.{decimal_part}"
    if is_negative:
        result = f"-{result}"
    return result
