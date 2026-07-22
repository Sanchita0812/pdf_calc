document.addEventListener('DOMContentLoaded', () => {
    // Session State
    let sessionState = {
        sessionId: null,
        columns: [],
        detected: {
            date_col: null,
            numeric_cols: []
        },
        dateRange: {
            min: null,
            max: null
        }
    };

    // DOM Elements
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress');
    const progressText = document.getElementById('progress-text');
    const progressPercent = document.getElementById('progress-percent');
    
    const errorAlert = document.getElementById('error-alert');
    const errorMessage = document.getElementById('error-message');
    
    const filterSection = document.getElementById('filter-section');
    const dateColSelect = document.getElementById('date-col-select');
    const amountColSelect = document.getElementById('amount-col-select');
    const fromDateInput = document.getElementById('from-date-input');
    const toDateInput = document.getElementById('to-date-input');
    const filterForm = document.getElementById('filter-form');
    const calculateBtn = document.getElementById('calculate-btn');
    const calcSpinner = document.getElementById('calc-spinner');

    const resultsSection = document.getElementById('results-section');
    const statTotal = document.getElementById('stat-total');
    const statCount = document.getElementById('stat-count');
    const statAverage = document.getElementById('stat-average');
    const statMin = document.getElementById('stat-min');
    const statMax = document.getElementById('stat-max');

    const downloadCsvBtn = document.getElementById('download-csv-btn');
    const downloadXlsxBtn = document.getElementById('download-xlsx-btn');

    const previewSection = document.getElementById('preview-section');
    const previewRowCount = document.getElementById('preview-row-count');
    const previewTheadRow = document.getElementById('preview-thead-row');
    const previewTbody = document.getElementById('preview-tbody');

    // --- DRAG & DROP EVENTS ---
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    // Handle selected file
    function handleFileSelect(file) {
        if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
            showError('Please upload a valid PDF file.');
            return;
        }
        uploadFile(file);
    }

    // --- UPLOAD CONTROLLER ---
    function uploadFile(file) {
        // Reset previous states
        hideError();
        hideSections();
        progressContainer.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressPercent.textContent = '0%';
        progressText.textContent = 'Uploading statement...';

        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        // Upload progress
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = percent + '%';
                progressPercent.textContent = percent + '%';
                if (percent === 100) {
                    progressText.textContent = 'Parsing statement tables (this may take a few seconds)...';
                }
            }
        });

        // Load finish
        xhr.onload = function() {
            progressContainer.classList.add('hidden');
            if (xhr.status === 200) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    onUploadSuccess(response);
                } catch (e) {
                    showError('Unexpected response from server.');
                }
            } else {
                try {
                    const response = JSON.parse(xhr.responseText);
                    showError(response.error || 'Failed to parse the bank statement PDF.');
                } catch (e) {
                    showError('Failed to upload and parse statement.');
                }
            }
        };

        xhr.onerror = function() {
            progressContainer.classList.add('hidden');
            showError('Network error occurred during upload.');
        };

        xhr.send(formData);
    }

    // Success response handler
    function onUploadSuccess(data) {
        sessionState.sessionId = data.session_id;
        sessionState.columns = data.columns;
        sessionState.detected = data.detected;
        sessionState.dateRange = data.date_range;

        // Populate dropdown selectors
        populateDropdowns();

        // Populate dates
        if (sessionState.dateRange.min) {
            fromDateInput.value = sessionState.dateRange.min;
            fromDateInput.min = sessionState.dateRange.min;
            fromDateInput.max = sessionState.dateRange.max;
        } else {
            fromDateInput.value = '';
        }

        if (sessionState.dateRange.max) {
            toDateInput.value = sessionState.dateRange.max;
            toDateInput.min = sessionState.dateRange.min;
            toDateInput.max = sessionState.dateRange.max;
        } else {
            toDateInput.value = '';
        }

        // Build Table Preview
        buildPreviewTable(data.preview);

        // Show sections
        filterSection.classList.remove('hidden');
        previewSection.classList.remove('hidden');

        // Automatically run initial calculation if possible
        if (sessionState.detected.date_col && sessionState.detected.numeric_cols.length > 0 && sessionState.dateRange.min && sessionState.dateRange.max) {
            triggerCalculation();
        }
    }

    // Populates Select elements with DataFrame column names
    function populateDropdowns() {
        // Clear options
        dateColSelect.innerHTML = '<option value="" disabled>Select Date Column</option>';
        amountColSelect.innerHTML = '<option value="" disabled>Select Amount Column</option>';

        const columns = sessionState.columns;
        const detectedDate = sessionState.detected.date_col;
        const detectedNumeric = sessionState.detected.numeric_cols;

        columns.forEach(col => {
            // Add to date dropdown
            const dateOpt = document.createElement('option');
            dateOpt.value = col;
            dateOpt.textContent = col;
            if (col === detectedDate) {
                dateOpt.selected = true;
            }
            dateColSelect.appendChild(dateOpt);

            // Add to amount dropdown
            const amtOpt = document.createElement('option');
            amtOpt.value = col;
            amtOpt.textContent = col;
            // Select if it's the first detected numeric column
            if (detectedNumeric.length > 0 && col === detectedNumeric[0]) {
                amtOpt.selected = true;
            }
            amountColSelect.appendChild(amtOpt);
        });

        // If no auto-selected date option matches, select first
        if (!dateColSelect.value && dateColSelect.options.length > 1) {
            dateColSelect.selectedIndex = 1;
        }
        // If no auto-selected amount option matches, select first
        if (!amountColSelect.value && amountColSelect.options.length > 1) {
            amountColSelect.selectedIndex = 1;
        }
    }

    // Build tabular preview
    function buildPreviewTable(rows) {
        previewTheadRow.innerHTML = '';
        previewTbody.innerHTML = '';

        if (!rows || rows.length === 0) {
            previewRowCount.textContent = '0 Rows Loaded';
            return;
        }

        const columns = sessionState.columns;
        previewRowCount.textContent = `${rows.length} Rows Loaded`;

        // 1. Build Headers
        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            
            // Highlights
            if (col === dateColSelect.value) {
                th.classList.add('highlight-date');
            } else if (col === amountColSelect.value || sessionState.detected.numeric_cols.includes(col)) {
                th.classList.add('highlight-numeric');
            }
            previewTheadRow.appendChild(th);
        });

        // 2. Build Rows
        rows.forEach(row => {
            const tr = document.createElement('tr');
            columns.forEach(col => {
                const td = document.createElement('td');
                td.textContent = row[col] !== undefined ? row[col] : '';
                
                // Highlights
                if (col === dateColSelect.value) {
                    td.classList.add('highlight-date');
                } else if (col === amountColSelect.value || sessionState.detected.numeric_cols.includes(col)) {
                    td.classList.add('highlight-numeric');
                }
                tr.appendChild(td);
            });
            previewTbody.appendChild(tr);
        });
    }

    // Update highlights in table columns when selectors change
    function updateTableHighlights() {
        const dateVal = dateColSelect.value;
        const amtVal = amountColSelect.value;
        const columns = sessionState.columns;

        // Update headers
        const ths = previewTheadRow.querySelectorAll('th');
        ths.forEach((th, idx) => {
            const col = columns[idx];
            th.className = ''; // Reset
            if (col === dateVal) {
                th.classList.add('highlight-date');
            } else if (col === amtVal || sessionState.detected.numeric_cols.includes(col)) {
                th.classList.add('highlight-numeric');
            }
        });

        // Update body rows
        const trs = previewTbody.querySelectorAll('tr');
        trs.forEach(tr => {
            const tds = tr.querySelectorAll('td');
            tds.forEach((td, idx) => {
                const col = columns[idx];
                td.className = ''; // Reset
                if (col === dateVal) {
                    td.classList.add('highlight-date');
                } else if (col === amtVal || sessionState.detected.numeric_cols.includes(col)) {
                    td.classList.add('highlight-numeric');
                }
            });
        });
    }

    // Track selector changes to update column highlighting in table
    dateColSelect.addEventListener('change', updateTableHighlights);
    amountColSelect.addEventListener('change', updateTableHighlights);

    // --- CALCULATION HANDLER ---
    filterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        triggerCalculation();
    });

    function triggerCalculation() {
        if (!sessionState.sessionId) return;

        // Validation
        const dateCol = dateColSelect.value;
        const amountCol = amountColSelect.value;
        const fromDate = fromDateInput.value;
        const toDate = toDateInput.value;

        if (!dateCol || !amountCol || !fromDate || !toDate) {
            showError('Please configure all filters correctly.');
            return;
        }

        // Show spinner
        calculateBtn.disabled = true;
        calcSpinner.classList.remove('hidden');

        fetch('/calculate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_id: sessionState.sessionId,
                date_col: dateCol,
                amount_col: amountCol,
                from_date: fromDate,
                to_date: toDate
            })
        })
        .then(res => res.json())
        .then(data => {
            calculateBtn.disabled = false;
            calcSpinner.classList.add('hidden');

            if (data.error) {
                showError(data.error);
                resultsSection.classList.add('hidden');
            } else {
                hideError();
                // Render stats
                statTotal.textContent = data.total;
                statCount.textContent = data.count;
                statAverage.textContent = data.average;
                statMin.textContent = data.min;
                statMax.textContent = data.max;

                resultsSection.classList.remove('hidden');
                
                // Scroll to results
                resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        })
        .catch(() => {
            calculateBtn.disabled = false;
            calcSpinner.classList.add('hidden');
            showError('Network error occurred while calculating.');
        });
    }

    // --- DOWNLOAD/EXPORT CONTROLLER ---
    function triggerDownload(fileType) {
        if (!sessionState.sessionId) return;

        const dateCol = dateColSelect.value;
        const amountCol = amountColSelect.value;
        const fromDate = fromDateInput.value;
        const toDate = toDateInput.value;

        if (!dateCol || !amountCol || !fromDate || !toDate) {
            showError('Please check parameters before exporting.');
            return;
        }

        // Build GET download URL with query params
        const params = new URLSearchParams({
            session_id: sessionState.sessionId,
            date_col: dateCol,
            amount_col: amountCol,
            from_date: fromDate,
            to_date: toDate
        });

        window.location.href = `/download/${fileType}?${params.toString()}`;
    }

    downloadCsvBtn.addEventListener('click', () => triggerDownload('csv'));
    downloadXlsxBtn.addEventListener('click', () => triggerDownload('excel'));

    // --- HELPERS ---
    function showError(msg) {
        errorMessage.textContent = msg;
        errorAlert.classList.remove('hidden');
        errorAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function hideError() {
        errorAlert.classList.add('hidden');
    }

    function hideSections() {
        filterSection.classList.add('hidden');
        resultsSection.classList.add('hidden');
        previewSection.classList.add('hidden');
    }
});
