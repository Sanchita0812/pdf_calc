import os
import uuid
import io
import datetime
import mimetypes
from flask import Flask, render_template, request, jsonify, send_file
import pandas as pd
from parser import parse_pdf, parse_image
from pdfminer.pdfdocument import PDFPasswordIncorrect
from utils import parse_date, clean_amount, format_indian_currency

# Ensure correct MIME type detection for static assets on cloud hosting
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/javascript', '.js')

app = Flask(__name__)

# Configure upload folder
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    filename_lower = file.filename.lower()
    is_pdf = filename_lower.endswith('.pdf')
    is_image = filename_lower.endswith(('.png', '.jpg', '.jpeg'))
    
    if not (is_pdf or is_image):
        return jsonify({'error': 'Only PDF and image files (PNG, JPG, JPEG) are supported'}), 400
        
    password = request.form.get('password')
    if not password:
        password = None

    session_id = str(uuid.uuid4())
    file_ext = os.path.splitext(filename_lower)[1]
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}{file_ext}")

    try:
        file.save(file_path)
        
        # Parse PDF or Image
        if is_image:
            df, detected = parse_image(file_path)
        else:
            df, detected = parse_pdf(file_path, password=password)
            
        # Clean up uploaded file to save space
        if os.path.exists(file_path):
            os.remove(file_path)
            
        if df.empty:
            if is_image:
                err_msg = 'No tabular data could be extracted from this image. Please ensure the image is clear and contains a transaction statement table.'
            else:
                err_msg = 'No tabular data could be extracted from this PDF. Please ensure it is a digital (text-based) bank statement.'
            return jsonify({'error': err_msg}), 400
            
        # Save DataFrame as CSV for session persistence
        csv_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}.csv")
        df.to_csv(csv_path, index=False)
        
        # Determine date range defaults
        min_date = None
        max_date = None
        if detected['date_col'] and detected['date_col'] in df.columns:
            parsed_dates = df[detected['date_col']].apply(parse_date).dropna()
            if not parsed_dates.empty:
                min_date = min(parsed_dates).isoformat()
                max_date = max(parsed_dates).isoformat()
                
        preview_rows = df.head(20).fillna('').to_dict(orient='records')
        
        return jsonify({
            'session_id': session_id,
            'columns': df.columns.tolist(),
            'detected': detected,
            'preview': preview_rows,
            'date_range': {
                'min': min_date,
                'max': max_date
            }
        })
        
    except PDFPasswordIncorrect:
        # Clean up file on password error
        if os.path.exists(file_path):
            os.remove(file_path)
        msg = 'Incorrect password. Please try again.' if password else 'This PDF is password-protected. Please enter the password.'
        return jsonify({
            'error': msg,
            'password_required': True
        }), 401
        
    except Exception as e:
        # Clean up file on any other exception
        if os.path.exists(file_path):
            os.remove(file_path)
        import traceback
        traceback.print_exc()
        file_type_str = "image" if is_image else "PDF"
        return jsonify({'error': f'Failed to process {file_type_str}: {str(e)}'}), 500

@app.route('/calculate', methods=['POST'])
def calculate():
    data = request.json
    session_id = data.get('session_id')
    date_col = data.get('date_col')
    amount_col = data.get('amount_col')
    from_date_str = data.get('from_date')
    to_date_str = data.get('to_date')
    
    if not all([session_id, date_col, amount_col, from_date_str, to_date_str]):
        return jsonify({'error': 'Missing required fields'}), 400
        
    csv_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}.csv")
    if not os.path.exists(csv_path):
        return jsonify({'error': 'Session expired or data not found. Please upload the PDF again.'}), 404
        
    try:
        df = pd.read_csv(csv_path, dtype=str).fillna('')
        
        if date_col not in df.columns or amount_col not in df.columns:
            return jsonify({'error': 'Selected columns do not exist in the dataset.'}), 400
            
        # Parse boundary dates
        try:
            from_date = datetime.datetime.strptime(from_date_str, "%Y-%m-%d").date()
            to_date = datetime.datetime.strptime(to_date_str, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({'error': 'Invalid date format. Expected YYYY-MM-DD.'}), 400
            
        # Parse dates in statement
        statement_dates = df[date_col].apply(parse_date)
        valid_date_mask = statement_dates.notna()
        
        filtered_df = df[valid_date_mask].copy()
        filtered_dates = statement_dates[valid_date_mask]
        
        # Apply date range filter
        date_mask = (filtered_dates >= from_date) & (filtered_dates <= to_date)
        filtered_df = filtered_df[date_mask]
        
        if filtered_df.empty:
            return jsonify({
                'total': format_indian_currency(0.0),
                'count': 0,
                'average': format_indian_currency(0.0),
                'min': format_indian_currency(0.0),
                'max': format_indian_currency(0.0)
            })
            
        # Clean numeric column
        amounts = filtered_df[amount_col].apply(clean_amount)
        
        # Calculate stats
        total = amounts.sum()
        non_zero_amounts = amounts[amounts != 0.0]
        count = len(non_zero_amounts)
        average = non_zero_amounts.mean() if count > 0 else 0.0
        min_val = non_zero_amounts.min() if count > 0 else 0.0
        max_val = non_zero_amounts.max() if count > 0 else 0.0
        
        return jsonify({
            'total': format_indian_currency(total),
            'count': count,
            'average': format_indian_currency(average),
            'min': format_indian_currency(min_val),
            'max': format_indian_currency(max_val)
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Calculation error: {str(e)}'}), 500

@app.route('/download/<file_type>', methods=['GET'])
def download(file_type):
    if file_type not in ['csv', 'excel']:
        return "Invalid file type", 400
        
    session_id = request.args.get('session_id')
    date_col = request.args.get('date_col')
    amount_col = request.args.get('amount_col')
    from_date_str = request.args.get('from_date')
    to_date_str = request.args.get('to_date')
    
    if not all([session_id, date_col, amount_col, from_date_str, to_date_str]):
        return "Missing required parameters", 400
        
    csv_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}.csv")
    if not os.path.exists(csv_path):
        return "Session expired or data not found", 404
        
    try:
        df = pd.read_csv(csv_path, dtype=str).fillna('')
        
        from_date = datetime.datetime.strptime(from_date_str, "%Y-%m-%d").date()
        to_date = datetime.datetime.strptime(to_date_str, "%Y-%m-%d").date()
        
        statement_dates = df[date_col].apply(parse_date)
        valid_date_mask = statement_dates.notna()
        
        filtered_df = df[valid_date_mask].copy()
        filtered_dates = statement_dates[valid_date_mask]
        
        date_mask = (filtered_dates >= from_date) & (filtered_dates <= to_date)
        filtered_df = filtered_df[date_mask]
        
        buffer = io.BytesIO()
        
        if file_type == 'csv':
            filtered_df.to_csv(buffer, index=False)
            buffer.seek(0)
            return send_file(
                buffer,
                mimetype="text/csv",
                as_attachment=True,
                download_name=f"filtered_statement_{from_date_str}_to_{to_date_str}.csv"
            )
        elif file_type == 'excel':
            filtered_df.to_excel(buffer, index=False, engine='openpyxl')
            buffer.seek(0)
            return send_file(
                buffer,
                mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                as_attachment=True,
                download_name=f"filtered_statement_{from_date_str}_to_{to_date_str}.xlsx"
            )
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        return f"Download failed: {str(e)}", 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, host='0.0.0.0', port=port)
