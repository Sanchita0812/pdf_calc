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
    
    // Password Elements
    const passwordContainer = document.getElementById('password-container');
    const passwordForm = document.getElementById('password-form');
    const pdfPasswordInput = document.getElementById('pdf-password-input');
    const togglePasswordBtn = document.getElementById('toggle-password-visibility');
    const unlockBtn = document.getElementById('unlock-btn');
    const unlockSpinner = document.getElementById('unlock-spinner');
    
    const filterSection = document.getElementById('filter-section');
    const dateColSelect = document.getElementById('date-col-select');
    const amountColSelect = document.getElementById('amount-col-select');
    const fromDateInput = document.getElementById('from-date-input');
    const toDateInput = document.getElementById('to-date-input');
    const descColSelect = document.getElementById('desc-col-select');
    const descFilterType = document.getElementById('desc-filter-type');
    const descFilterInput = document.getElementById('desc-filter-input');
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

    let currentFile = null;
    const eyeIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-eye"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const eyeOffIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-eye-off"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

    // Handle selected file
    function handleFileSelect(file) {
        const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
        const isImage = file.type.startsWith('image/') || /\.(png|jpe?g)$/i.test(file.name);
        
        if (!isPdf && !isImage) {
            showError('Please upload a valid PDF file or image (PNG, JPG, JPEG).');
            return;
        }
        
        currentFile = file;
        
        // Hide password section on new file select
        passwordContainer.classList.add('hidden');
        pdfPasswordInput.value = '';
        pdfPasswordInput.type = 'password';
        togglePasswordBtn.innerHTML = eyeIconSvg;
        
        uploadFile(file);
    }

    // --- UPLOAD CONTROLLER ---
    function uploadFile(file, password = '') {
        // Reset previous states
        hideError();
        hideSections();
        progressContainer.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressPercent.textContent = '0%';
        progressText.textContent = 'Uploading statement...';
        
        // Disable unlock buttons if form was submitted
        unlockBtn.disabled = true;
        unlockSpinner.classList.remove('hidden');

        const formData = new FormData();
        formData.append('file', file);
        if (password) {
            formData.append('password', password);
        }

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        // Upload progress
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = percent + '%';
                progressPercent.textContent = percent + '%';
                if (percent === 100) {
                    progressText.textContent = 'Parsing statement data (this may take a few seconds)...';
                }
            }
        });

        // Load finish
        xhr.onload = function() {
            progressContainer.classList.add('hidden');
            unlockBtn.disabled = false;
            unlockSpinner.classList.add('hidden');
            
            if (xhr.status === 200) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    passwordContainer.classList.add('hidden'); // Success, hide password box
                    onUploadSuccess(response);
                } catch (e) {
                    showError('Unexpected response from server.');
                }
            } else if (xhr.status === 401) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (response.password_required) {
                        showError(response.error || 'Password required to unlock PDF.');
                        passwordContainer.classList.remove('hidden');
                        pdfPasswordInput.focus();
                        pdfPasswordInput.select();
                    } else {
                        showError(response.error || 'Unauthorized action.');
                    }
                } catch (e) {
                    showError('Failed to unlock and parse statement.');
                }
            } else {
                try {
                    const response = JSON.parse(xhr.responseText);
                    showError(response.error || 'Failed to parse the bank statement.');
                } catch (e) {
                    showError('Failed to upload and parse statement.');
                }
            }
        };

        xhr.onerror = function() {
            progressContainer.classList.add('hidden');
            unlockBtn.disabled = false;
            unlockSpinner.classList.add('hidden');
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
        descColSelect.innerHTML = '<option value="">No Description Filter</option>';

        const columns = sessionState.columns;
        const detectedDate = sessionState.detected.date_col;
        const detectedNumeric = sessionState.detected.numeric_cols;
        const detectedDesc = sessionState.detected.desc_col;

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

            // Add to description dropdown
            const descOpt = document.createElement('option');
            descOpt.value = col;
            descOpt.textContent = col;
            if (col === detectedDesc) {
                descOpt.selected = true;
            }
            descColSelect.appendChild(descOpt);
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
        const descCol = descColSelect.value;
        const descFilter = descFilterInput.value;
        const descFilterType = descFilterType.value;

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
                to_date: toDate,
                desc_col: descCol,
                desc_filter: descFilter,
                desc_filter_type: descFilterType
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
        const descCol = descColSelect.value;
        const descFilter = descFilterInput.value;
        const descFilterType = descFilterType.value;

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
            to_date: toDate,
            desc_col: descCol,
            desc_filter: descFilter,
            desc_filter_type: descFilterType
        });

        window.location.href = `/download/${fileType}?${params.toString()}`;
    }

    downloadCsvBtn.addEventListener('click', () => triggerDownload('csv'));
    downloadXlsxBtn.addEventListener('click', () => triggerDownload('excel'));

    // --- PASSWORD CONTROLLER LISTENERS ---
    passwordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const passwordValue = pdfPasswordInput.value;
        if (!passwordValue) {
            showError('Please enter a password.');
            return;
        }
        if (currentFile) {
            uploadFile(currentFile, passwordValue);
        }
    });

    togglePasswordBtn.addEventListener('click', () => {
        if (pdfPasswordInput.type === 'password') {
            pdfPasswordInput.type = 'text';
            togglePasswordBtn.innerHTML = eyeOffIconSvg;
            togglePasswordBtn.title = 'Hide password';
        } else {
            pdfPasswordInput.type = 'password';
            togglePasswordBtn.innerHTML = eyeIconSvg;
            togglePasswordBtn.title = 'Show password';
        }
    });

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
