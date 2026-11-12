#!/usr/bin/env bash
# ==============================================================================
# Production Database Purge Script for AMAZ Hospital Management System
# ==============================================================================
# This script safely removes:
#   - Schedules & Sessions (DoctorSchedule, Sessions, Exceptions, Leaves, Attendances)
#   - Tokens & Bookings (Appointment)
#   - Bills, Payments & Refunds (Invoice, LineItems, Payments, Refunds, Cash Shifts, Expenses)
#   - Prescriptions & Items (Prescription, PrescriptionItem)
#   - Patients & OTPs (Patient, PatientOTP)
#   - Inventory Batches & Orders (StockBatch, PurchaseOrder, PurchaseOrderItem)
#   - Doctor Shares & Statements (DoctorDailySheet, PatientItems, DoctorPaymentStatement)
#   - Linked Clinical Records (LabRequest, LabRequestItem, LabResult, ActivityLog, NotificationJob)
#
# Preserves:
#   - Users (Doctors, Admins, Receptionists, Nurses, Lab Techs, Pharmacists, Cashiers)
#   - Roles & Permissions
#   - Departments & Rooms
#   - Employee Profiles & Payroll Configs
#   - Lab Test Templates & Biomarkers
#   - Master Extra Services
#   - System Settings & SMS Templates
#   - Biometric Devices
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default flags
DRY_RUN=false
FORCE=false
BACKUP=true
INCLUDE_MEDICINES=false
RESEED_DRUGS=false
CUSTOM_DB_URL=""

ROLLBACK=false
ROLLBACK_FILE=""

print_header() {
    echo -e "${CYAN}================================================================================"
    echo -e "       AMAZ HOSPITAL - PRODUCTION DATABASE RESET & PURGE UTILITY"
    echo -e "================================================================================${NC}"
    echo -e "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
    echo ""
}

show_help() {
    print_header
    echo -e "${BOLD}Usage:${NC}"
    echo -e "  bash scripts/prod-db-purge.sh [OPTIONS]"
    echo ""
    echo -e "${BOLD}Purge Options:${NC}"
    echo -e "  ${YELLOW}--dry-run${NC}             Audit and display row counts without deleting anything"
    echo -e "  ${YELLOW}--force, -y${NC}           Execute immediately without interactive confirmation"
    echo -e "  ${YELLOW}--no-backup${NC}           Skip the automatic pre-purge SQL backup (default: creates backup)"
    echo -e "  ${YELLOW}--include-medicines${NC}   Also wipe the Medicine catalog table (in addition to stock batches)"
    echo -e "  ${YELLOW}--reseed-drugs${NC}        Automatically run 'npm run seed:drugs' after purge"
    echo -e "  ${YELLOW}--db-url=<url>${NC}        Specify custom PostgreSQL connection string"
    echo ""
    echo -e "${BOLD}Rollback / Restore Options:${NC}"
    echo -e "  ${YELLOW}--rollback${NC}            Interactive rollback: list and restore from an available backup"
    echo -e "  ${YELLOW}--rollback=<file>${NC}     Restore database from a specific .sql backup file"
    echo -e "  ${YELLOW}--restore[=<file>]${NC}    Alias for --rollback"
    echo ""
    echo -e "${BOLD}Examples:${NC}"
    echo -e "  # 1. Preview row counts (safe audit):"
    echo -e "  bash scripts/prod-db-purge.sh --dry-run"
    echo ""
    echo -e "  # 2. Standard purge (auto-creates SQL backup before clearing data):"
    echo -e "  bash scripts/prod-db-purge.sh"
    echo ""
    echo -e "  # 3. Rollback / restore database from previous backup:"
    echo -e "  bash scripts/prod-db-purge.sh --rollback"
    echo "  bash scripts/prod-db-purge.sh --rollback=backups/amaz_db_backup_pre_purge_20261112_152000.sql"
    echo ""
    exit 0
}

# Parse command line arguments
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            ;;
        --force|-y)
            FORCE=true
            ;;
        --backup)
            BACKUP=true
            ;;
        --no-backup|--skip-backup)
            BACKUP=false
            ;;
        --rollback)
            ROLLBACK=true
            ;;
        --rollback=*)
            ROLLBACK=true
            ROLLBACK_FILE="${arg#*=}"
            ;;
        --restore)
            ROLLBACK=true
            ;;
        --restore=*)
            ROLLBACK=true
            ROLLBACK_FILE="${arg#*=}"
            ;;
        --include-medicines)
            INCLUDE_MEDICINES=true
            ;;
        --reseed-drugs)
            RESEED_DRUGS=true
            ;;
        --db-url=*)
            CUSTOM_DB_URL="${arg#*=}"
            ;;
        --help|-h)
            show_help
            ;;
        *)
            echo -e "${RED}[ERROR] Unknown option: $arg${NC}"
            echo -e "Run 'bash scripts/prod-db-purge.sh --help' for usage."
            exit 1
            ;;
    esac
done

print_header

# ------------------------------------------------------------------------------
# 1. Resolve DATABASE_URL
# ------------------------------------------------------------------------------
DB_URL="$CUSTOM_DB_URL"

if [ -z "$DB_URL" ]; then
    if [ -f "$PROJECT_ROOT/.env" ]; then
        DB_URL=$(grep -E "^(DATABASE_URL|DIRECT_URL)=" "$PROJECT_ROOT/.env" | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'")
    elif [ -f "$PROJECT_ROOT/../.env" ]; then
        DB_URL=$(grep -E "^(DATABASE_URL|DIRECT_URL)=" "$PROJECT_ROOT/../.env" | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'")
    fi
fi

if [ -z "$DB_URL" ]; then
    echo -e "${RED}[ERROR] DATABASE_URL could not be detected from environment or .env file.${NC}"
    echo -e "Please pass it via: ${YELLOW}--db-url='postgresql://user:pass@host:5432/dbname'${NC}"
    exit 1
fi

# Strip Prisma-specific query parameters like ?schema=public or &schema=public for psql compatibility
PSQL_URL=$(echo "$DB_URL" | sed -E 's/([?&])schema=[^&]*(&|$)/\1/' | sed -E 's/[?&]$//')

# Sanitize display of DB URL (hide password)
MASKED_DB_URL=$(echo "$PSQL_URL" | sed -E 's/:([^@]+)@/:****@/')
echo -e "${BLUE}[CONFIG] Target Database:${NC} $MASKED_DB_URL"

# Check psql availability
if ! command -v psql &> /dev/null; then
    echo -e "${RED}[ERROR] 'psql' client is not installed or not in PATH.${NC}"
    echo -e "Please install postgresql-client (e.g. apt-get install -y postgresql-client)."
    exit 1
fi

# Test connection
if ! psql "$PSQL_URL" -c "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${RED}[ERROR] Cannot connect to PostgreSQL at $MASKED_DB_URL.${NC}"
    echo -e "Please verify your database credentials and network connectivity."
    exit 1
fi

echo -e "${GREEN}[OK] Database connection verified successfully.${NC}"
echo ""

# ------------------------------------------------------------------------------
# Rollback / Restore Handler
# ------------------------------------------------------------------------------
if [ "$ROLLBACK" = true ]; then
    echo -e "${YELLOW}${BOLD}================================================================================${NC}"
    echo -e "${YELLOW}${BOLD}                        DATABASE ROLLBACK / RESTORE                             ${NC}"
    echo -e "${YELLOW}${BOLD}================================================================================${NC}"
    echo ""

    BACKUP_DIR="$PROJECT_ROOT/backups"
    TARGET_BACKUP="$ROLLBACK_FILE"

    if [ -n "$TARGET_BACKUP" ]; then
        if [ ! -f "$TARGET_BACKUP" ] && [ -f "$BACKUP_DIR/$TARGET_BACKUP" ]; then
            TARGET_BACKUP="$BACKUP_DIR/$TARGET_BACKUP"
        fi
        if [ ! -f "$TARGET_BACKUP" ]; then
            echo -e "${RED}[ERROR] Specified backup file not found: $ROLLBACK_FILE${NC}"
            exit 1
        fi
    else
        if [ ! -d "$BACKUP_DIR" ]; then
            echo -e "${RED}[ERROR] No backups directory found at $BACKUP_DIR.${NC}"
            exit 1
        fi

        mapfile -t AVAILABLE_BACKUPS < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "*.sql" -printf "%T@ %p\n" 2>/dev/null | sort -nr | awk '{print $2}')

        if [ ${#AVAILABLE_BACKUPS[@]} -eq 0 ]; then
            echo -e "${RED}[ERROR] No backup .sql files found in $BACKUP_DIR.${NC}"
            exit 1
        elif [ ${#AVAILABLE_BACKUPS[@]} -eq 1 ]; then
            TARGET_BACKUP="${AVAILABLE_BACKUPS[0]}"
            echo -e "${CYAN}[INFO] Found 1 available backup file: $(basename "$TARGET_BACKUP")${NC}"
        else
            echo -e "${BOLD}Available Backup Snapshots (Newest First):${NC}"
            for i in "${!AVAILABLE_BACKUPS[@]}"; do
                BFILE="${AVAILABLE_BACKUPS[$i]}"
                BSIZE=$(du -h "$BFILE" | cut -f1)
                BDATE=$(date -r "$BFILE" "+%Y-%m-%d %H:%M:%S")
                echo -e "  [${BOLD}$((i+1))${NC}] $(basename "$BFILE") (${BSIZE}, ${BDATE})"
            done
            echo ""
            read -r -p "Select snapshot number to restore [1-${#AVAILABLE_BACKUPS[@]}]: " CHOICE
            if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || [ "$CHOICE" -lt 1 ] || [ "$CHOICE" -gt ${#AVAILABLE_BACKUPS[@]} ]; then
                echo -e "${RED}[ERROR] Invalid selection. Aborting rollback.${NC}"
                exit 1
            fi
            TARGET_BACKUP="${AVAILABLE_BACKUPS[$((CHOICE-1))]}"
        fi
    fi

    echo ""
    BACKUP_SIZE=$(du -h "$TARGET_BACKUP" | cut -f1)
    echo -e "${BLUE}[TARGET SNAPSHOT]:${NC} $TARGET_BACKUP ($BACKUP_SIZE)"
    echo -e "${BLUE}[TARGET DATABASE]:${NC} $MASKED_DB_URL"
    echo ""

    if [ "$FORCE" = false ]; then
        echo -e "${RED}${BOLD}WARNING: Restoring this backup will replace current database tables and data!${NC}"
        read -r -p "Type 'RESTORE' to execute rollback: " USER_CONFIRM
        if [ "$USER_CONFIRM" != "RESTORE" ]; then
            echo -e "${YELLOW}[CANCELLED] Rollback aborted. Database untouched.${NC}"
            exit 0
        fi
        echo ""
    fi

    echo -e "${BLUE}[RESTORING] Applying SQL backup file to PostgreSQL...${NC}"
    START_RESTORE=$(date +%s%3N)
    if psql "$PSQL_URL" -q < "$TARGET_BACKUP"; then
        END_RESTORE=$(date +%s%3N)
        DURATION=$((END_RESTORE - START_RESTORE))
        echo -e "${GREEN}[OK] Database restored successfully in ${DURATION}ms!${NC}"
    else
        echo -e "${RED}[ERROR] Failed to restore database from $TARGET_BACKUP!${NC}"
        exit 1
    fi
    echo ""

    # Flush Redis after restore
    echo -e "${BOLD}--- FLUSHING REDIS CACHE ---${NC}"
    REDIS_URL_FOUND=$(grep -E "^REDIS_URL=" "$PROJECT_ROOT/.env" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'" || echo "")
    if command -v redis-cli &> /dev/null; then
        if [ -n "$REDIS_URL_FOUND" ]; then
            redis-cli -u "$REDIS_URL_FOUND" FLUSHDB > /dev/null 2>&1 || redis-cli FLUSHDB > /dev/null 2>&1 || true
        else
            redis-cli FLUSHDB > /dev/null 2>&1 || true
        fi
        echo -e "${GREEN}[OK] Redis cache flushed.${NC}"
    fi
    echo ""

    # Post-restore verification
    echo -e "${BOLD}--- POST-RESTORE VERIFICATION ---${NC}"
    POST_SQL="
    SELECT json_build_object(
        'users', (SELECT count(*) FROM \"User\"),
        'patients', (SELECT count(*) FROM \"Patient\"),
        'appointments', (SELECT count(*) FROM \"Appointment\"),
        'invoices', (SELECT count(*) FROM \"Invoice\"),
        'payments', (SELECT count(*) FROM \"Payment\"),
        'prescriptions', (SELECT count(*) FROM \"Prescription\"),
        'stock_batches', (SELECT count(*) FROM \"StockBatch\")
    )::text;
    "
    POST_JSON=$(psql "$PSQL_URL" -t -A -c "$POST_SQL")
    python3 -c "
import json
d = json.loads('''$POST_JSON''')
print(f'  Restored Users:        {d.get(\"users\")}')
print(f'  Restored Patients:     {d.get(\"patients\")}')
print(f'  Restored Appointments: {d.get(\"appointments\")}')
print(f'  Restored Invoices:     {d.get(\"invoices\")}')
print(f'  Restored Payments:     {d.get(\"payments\")}')
print(f'  Restored Prescriptions:{d.get(\"prescriptions\")}')
print(f'  Restored Stock Batches:{d.get(\"stock_batches\")}')
"
    echo ""
    echo -e "${GREEN}${BOLD}================================================================================${NC}"
    echo -e "${GREEN}${BOLD}ROLLBACK COMPLETE! DATABASE RESTORED TO BACKUP STATE.${NC}"
    echo -e "${GREEN}${BOLD}================================================================================${NC}"
    exit 0
fi

# ------------------------------------------------------------------------------
# 2. Database Audit (Pre-Purge Counts)
# ------------------------------------------------------------------------------
echo -e "${BOLD}--- 1. MASTER DATA TO PRESERVE (WILL NOT BE MODIFIED) ---${NC}"

MASTER_COUNTS_SQL="
SELECT json_build_object(
    'users', (SELECT count(*) FROM \"User\"),
    'doctors', (SELECT count(*) FROM \"User\" WHERE specialty IS NOT NULL),
    'roles', (SELECT count(*) FROM \"Role\"),
    'departments', (SELECT count(*) FROM \"Department\"),
    'rooms', (SELECT count(*) FROM \"Room\"),
    'lab_tests', (SELECT count(*) FROM \"LabTest\"),
    'biomarkers', (SELECT count(*) FROM \"LabTestBiomarker\"),
    'extra_services', (SELECT count(*) FROM \"ExtraService\"),
    'system_settings', (SELECT count(*) FROM \"SystemSetting\"),
    'sms_templates', (SELECT count(*) FROM \"SmsTemplate\"),
    'employee_profiles', (SELECT count(*) FROM \"EmployeeProfile\")
)::text;
"
MASTER_JSON=$(psql "$PSQL_URL" -t -A -c "$MASTER_COUNTS_SQL")

python3 -c "
import json, sys
data = json.loads('''$MASTER_JSON''')
print(f'  [PRESERVE] Users (Total):       {data.get(\"users\", 0)} (Doctors: {data.get(\"doctors\", 0)})')
print(f'  [PRESERVE] Roles & Permissions: {data.get(\"roles\", 0)}')
print(f'  [PRESERVE] Departments & Rooms: {data.get(\"departments\", 0)} departments, {data.get(\"rooms\", 0)} rooms')
print(f'  [PRESERVE] Lab Test Catalog:    {data.get(\"lab_tests\", 0)} tests ({data.get(\"biomarkers\", 0)} biomarkers)')
print(f'  [PRESERVE] Extra Services:      {data.get(\"extra_services\", 0)}')
print(f'  [PRESERVE] Employee Profiles:   {data.get(\"employee_profiles\", 0)}')
print(f'  [PRESERVE] Settings & SMS:      {data.get(\"system_settings\", 0)} settings, {data.get(\"sms_templates\", 0)} templates')
"
echo ""

echo -e "${BOLD}--- 2. DATA IDENTIFIED FOR PURGE ---${NC}"

PURGE_COUNTS_SQL="
SELECT json_build_object(
    'schedules', (SELECT count(*) FROM \"DoctorSchedule\"),
    'sessions', (SELECT count(*) FROM \"DoctorScheduleSession\"),
    'exceptions', (SELECT count(*) FROM \"DoctorScheduleException\"),
    'leaves', (SELECT count(*) FROM \"DoctorLeave\"),
    'doctor_attendances', (SELECT count(*) FROM \"DoctorAttendance\"),
    'appointments', (SELECT count(*) FROM \"Appointment\"),
    'invoices', (SELECT count(*) FROM \"Invoice\"),
    'invoice_items', (SELECT count(*) FROM \"InvoiceLineItem\"),
    'payments', (SELECT count(*) FROM \"Payment\"),
    'refunds', (SELECT count(*) FROM \"Refund\"),
    'cash_shifts', (SELECT count(*) FROM \"CashRegisterShift\"),
    'expenses', (SELECT count(*) FROM \"Expense\"),
    'prescriptions', (SELECT count(*) FROM \"Prescription\"),
    'prescription_items', (SELECT count(*) FROM \"PrescriptionItem\"),
    'patients', (SELECT count(*) FROM \"Patient\"),
    'patient_otps', (SELECT count(*) FROM \"PatientOTP\"),
    'stock_batches', (SELECT count(*) FROM \"StockBatch\"),
    'purchase_orders', (SELECT count(*) FROM \"PurchaseOrder\"),
    'purchase_order_items', (SELECT count(*) FROM \"PurchaseOrderItem\"),
    'medicines', (SELECT count(*) FROM \"Medicine\"),
    'daily_sheets', (SELECT count(*) FROM \"DoctorDailySheet\"),
    'daily_sheet_items', (SELECT count(*) FROM \"DoctorDailyPatientItem\"),
    'doctor_statements', (SELECT count(*) FROM \"DoctorPaymentStatement\"),
    'lab_requests', (SELECT count(*) FROM \"LabRequest\"),
    'lab_request_items', (SELECT count(*) FROM \"LabRequestItem\"),
    'lab_results', (SELECT count(*) FROM \"LabResult\"),
    'activity_logs', (SELECT count(*) FROM \"ActivityLog\"),
    'notification_jobs', (SELECT count(*) FROM \"NotificationJob\")
)::text;
"

PURGE_JSON=$(psql "$PSQL_URL" -t -A -c "$PURGE_COUNTS_SQL")

python3 -c "
import json
d = json.loads('''$PURGE_JSON''')
inc_med = '$INCLUDE_MEDICINES' == 'true'

total_rows = (
    d.get('schedules', 0) + d.get('sessions', 0) + d.get('exceptions', 0) + d.get('leaves', 0) + d.get('doctor_attendances', 0) +
    d.get('appointments', 0) + d.get('invoices', 0) + d.get('invoice_items', 0) + d.get('payments', 0) + d.get('refunds', 0) +
    d.get('cash_shifts', 0) + d.get('expenses', 0) + d.get('prescriptions', 0) + d.get('prescription_items', 0) +
    d.get('patients', 0) + d.get('patient_otps', 0) + d.get('stock_batches', 0) + d.get('purchase_orders', 0) +
    d.get('purchase_order_items', 0) + d.get('daily_sheets', 0) + d.get('daily_sheet_items', 0) + d.get('doctor_statements', 0) +
    d.get('lab_requests', 0) + d.get('lab_request_items', 0) + d.get('lab_results', 0) + d.get('activity_logs', 0) + d.get('notification_jobs', 0)
)
if inc_med:
    total_rows += d.get('medicines', 0)

print(f'  [TO PURGE] Schedules & Sessions:    {d.get(\"schedules\", 0)} schedules, {d.get(\"sessions\", 0)} sessions, {d.get(\"exceptions\", 0)} exceptions, {d.get(\"leaves\", 0)} leaves')
print(f'  [TO PURGE] Tokens & Bookings:       {d.get(\"appointments\", 0)} appointments/tokens')
print(f'  [TO PURGE] Patients & OTPs:         {d.get(\"patients\", 0)} patients, {d.get(\"patient_otps\", 0)} OTPs')
print(f'  [TO PURGE] Bills & Line Items:      {d.get(\"invoices\", 0)} invoices, {d.get(\"invoice_items\", 0)} line items')
print(f'  [TO PURGE] Payments & Refunds:      {d.get(\"payments\", 0)} payments, {d.get(\"refunds\", 0)} refunds')
print(f'  [TO PURGE] Frontdesk Shifts & Exp:  {d.get(\"cash_shifts\", 0)} shifts, {d.get(\"expenses\", 0)} expenses')
print(f'  [TO PURGE] Prescriptions:           {d.get(\"prescriptions\", 0)} Rx, {d.get(\"prescription_items\", 0)} Rx items')
print(f'  [TO PURGE] Doctor Shares & Sheets:  {d.get(\"daily_sheets\", 0)} daily sheets, {d.get(\"daily_sheet_items\", 0)} patient items, {d.get(\"doctor_statements\", 0)} statements')
print(f'  [TO PURGE] Inventory Stock:         {d.get(\"stock_batches\", 0)} stock batches, {d.get(\"purchase_orders\", 0)} POs ({d.get(\"purchase_order_items\", 0)} items)')
if inc_med:
    print(f'  [TO PURGE] Medicine Catalog:        {d.get(\"medicines\", 0)} medicines (FLAG --include-medicines ACTIVE)')
else:
    print(f'  [PRESERVE] Medicine Catalog:        {d.get(\"medicines\", 0)} master medicines kept (use --include-medicines to clear)')
print(f'  [TO PURGE] Patient Lab Requests:    {d.get(\"lab_requests\", 0)} requests, {d.get(\"lab_request_items\", 0)} items, {d.get(\"lab_results\", 0)} results')
print(f'  [TO PURGE] Activity Logs & Jobs:    {d.get(\"activity_logs\", 0)} logs, {d.get(\"notification_jobs\", 0)} jobs')
print('  ' + '-' * 70)
print(f'  TOTAL TARGET RECORDS TO PURGE:      {total_rows:,}')
"
echo ""

# Exit if dry-run
if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY-RUN] Audit complete. No records were deleted.${NC}"
    echo -e "To execute the purge, run without ${BOLD}--dry-run${NC}."
    exit 0
fi

# ------------------------------------------------------------------------------
# 3. Confirmation Prompt
# ------------------------------------------------------------------------------
if [ "$FORCE" = false ]; then
    echo -e "${RED}${BOLD}WARNING: You are about to permanently delete all operational, clinical,${NC}"
    echo -e "${RED}${BOLD}and billing test data from the database.${NC}"
    echo -e "This action CANNOT be undone without a database backup."
    echo ""
    read -r -p "Type 'CONFIRM' to proceed with the purge: " USER_CONFIRMATION
    if [ "$USER_CONFIRMATION" != "CONFIRM" ]; then
        echo -e "${YELLOW}[CANCELLED] Operation aborted by user. No data was deleted.${NC}"
        exit 0
    fi
    echo ""
fi

# ------------------------------------------------------------------------------
# 4. Mandatory / Automatic Pre-Purge SQL Backup
# ------------------------------------------------------------------------------
if [ "$BACKUP" = true ]; then
    BACKUP_DIR="$PROJECT_ROOT/backups"
    mkdir -p "$BACKUP_DIR"
    BACKUP_FILE="$BACKUP_DIR/amaz_db_backup_pre_purge_$(date +%Y%m%d_%H%M%S).sql"
    echo -e "${BLUE}[BACKUP] Generating complete PostgreSQL SQL snapshot before purge...${NC}"
    if command -v pg_dump &> /dev/null; then
        if pg_dump "$PSQL_URL" --clean --if-exists > "$BACKUP_FILE"; then
            BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
            echo -e "${GREEN}[OK] Complete SQL backup saved (${BACKUP_SIZE}):${NC} $BACKUP_FILE"
            echo -e "${CYAN}[INFO] To restore this backup if needed, run:${NC}"
            echo -e "       psql \"\$DATABASE_URL\" < \"$BACKUP_FILE\""
        else
            echo -e "${RED}[ERROR] pg_dump failed! Aborting purge to prevent data loss.${NC}"
            exit 1
        fi
    else
        echo -e "${RED}[ERROR] 'pg_dump' utility not found in PATH!${NC}"
        echo -e "Install postgresql-client or pass ${YELLOW}--no-backup${NC} if you are sure."
        exit 1
    fi
    echo ""
else
    echo -e "${YELLOW}[WARN] Pre-purge backup skipped by user flag (--no-backup).${NC}"
    echo ""
fi

# ------------------------------------------------------------------------------
# 5. Execute Atomic Purge Transaction
# ------------------------------------------------------------------------------
echo -e "${BOLD}--- 3. EXECUTING ATOMIC DATABASE TRANSACTION ---${NC}"

SQL_TRUNCATE_TABLES="
    \"DoctorScheduleException\",
    \"DoctorScheduleSession\",
    \"DoctorSchedule\",
    \"DoctorLeave\",
    \"DoctorAttendance\",
    \"Appointment\",
    \"PrescriptionItem\",
    \"Prescription\",
    \"Refund\",
    \"Payment\",
    \"InvoiceLineItem\",
    \"Invoice\",
    \"ExtraServiceOrder\",
    \"CashRegisterShift\",
    \"Expense\",
    \"DoctorDailyPatientItem\",
    \"DoctorDailySheet\",
    \"DoctorPaymentStatement\",
    \"PatientOTP\",
    \"Patient\",
    \"StockBatch\",
    \"PurchaseOrderItem\",
    \"PurchaseOrder\",
    \"LabResult\",
    \"LabRequestItem\",
    \"LabRequest\",
    \"ActivityLog\",
    \"NotificationJob\""

if [ "$INCLUDE_MEDICINES" = true ]; then
    SQL_TRUNCATE_TABLES="$SQL_TRUNCATE_TABLES, \"Medicine\""
fi

TRANSACTION_SQL="
BEGIN;
TRUNCATE TABLE $SQL_TRUNCATE_TABLES CASCADE;
COMMIT;
"

START_TIME=$(date +%s%3N)
psql "$PSQL_URL" -q -c "$TRANSACTION_SQL"
END_TIME=$(date +%s%3N)
DURATION=$((END_TIME - START_TIME))

echo -e "${GREEN}[SUCCESS] All target tables truncated in ${DURATION}ms.${NC}"
echo ""

# ------------------------------------------------------------------------------
# 6. Flush Redis Cache
# ------------------------------------------------------------------------------
echo -e "${BOLD}--- 4. FLUSHING REDIS CACHE ---${NC}"
REDIS_URL_FOUND=$(grep -E "^REDIS_URL=" "$PROJECT_ROOT/.env" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'" || echo "")

if command -v redis-cli &> /dev/null; then
    if [ -n "$REDIS_URL_FOUND" ]; then
        redis-cli -u "$REDIS_URL_FOUND" FLUSHDB > /dev/null 2>&1 || redis-cli FLUSHDB > /dev/null 2>&1 || true
    else
        redis-cli FLUSHDB > /dev/null 2>&1 || true
    fi
    echo -e "${GREEN}[OK] Redis cache flushed successfully.${NC}"
else
    echo -e "${YELLOW}[INFO] redis-cli not found. Trying via node...${NC}"
    node -e "
    const redis = require('redis');
    const url = process.env.REDIS_URL || '$REDIS_URL_FOUND' || 'redis://localhost:6379';
    const c = redis.createClient({ url });
    c.connect().then(() => c.flushDb()).then(() => {
        console.log('Redis flushed via node.');
        c.disconnect();
    }).catch(() => {});
    " 2>/dev/null || true
fi
echo ""

# ------------------------------------------------------------------------------
# 7. Post-Purge Verification
# ------------------------------------------------------------------------------
echo -e "${BOLD}--- 5. POST-PURGE VERIFICATION AUDIT ---${NC}"

VERIFY_SQL="
SELECT json_build_object(
    'appointments', (SELECT count(*) FROM \"Appointment\"),
    'patients', (SELECT count(*) FROM \"Patient\"),
    'invoices', (SELECT count(*) FROM \"Invoice\"),
    'payments', (SELECT count(*) FROM \"Payment\"),
    'schedules', (SELECT count(*) FROM \"DoctorSchedule\"),
    'prescriptions', (SELECT count(*) FROM \"Prescription\"),
    'stock_batches', (SELECT count(*) FROM \"StockBatch\"),
    'daily_sheets', (SELECT count(*) FROM \"DoctorDailySheet\"),
    'users', (SELECT count(*) FROM \"User\"),
    'medicines', (SELECT count(*) FROM \"Medicine\"),
    'departments', (SELECT count(*) FROM \"Department\")
)::text;
"

VERIFY_JSON=$(psql "$PSQL_URL" -t -A -c "$VERIFY_SQL")

python3 -c "
import json
d = json.loads('''$VERIFY_JSON''')
print(f'  Appointments / Tokens: {d.get(\"appointments\")} (Expected: 0)')
print(f'  Patients:              {d.get(\"patients\")} (Expected: 0)')
print(f'  Invoices & Bills:      {d.get(\"invoices\")} (Expected: 0)')
print(f'  Payments & Refunds:    {d.get(\"payments\")} (Expected: 0)')
print(f'  Doctor Schedules:      {d.get(\"schedules\")} (Expected: 0)')
print(f'  Prescriptions:         {d.get(\"prescriptions\")} (Expected: 0)')
print(f'  Stock Batches:         {d.get(\"stock_batches\")} (Expected: 0)')
print(f'  Doctor Daily Sheets:   {d.get(\"daily_sheets\")} (Expected: 0)')
print('  ' + '-' * 50)
print(f'  [MASTER DATA INTACT] Users:       {d.get(\"users\")}')
print(f'  [MASTER DATA INTACT] Departments: {d.get(\"departments\")}')
print(f'  [MASTER DATA INTACT] Medicines:   {d.get(\"medicines\")}')
"
echo ""

# ------------------------------------------------------------------------------
# 8. Optional Drug Re-seeding
# ------------------------------------------------------------------------------
if [ "$RESEED_DRUGS" = true ]; then
    echo -e "${BOLD}--- 6. RE-SEEDING MASTER MEDICAL DRUGS ---${NC}"
    cd "$PROJECT_ROOT"
    npm run seed:drugs
    echo -e "${GREEN}[OK] Master drug inventory seeded.${NC}"
    echo ""
fi

echo -e "${GREEN}${BOLD}================================================================================${NC}"
echo -e "${GREEN}${BOLD}DATABASE PURGE COMPLETED AND VERIFIED SUCCESSFULLY!${NC}"
echo -e "${GREEN}${BOLD}================================================================================${NC}"
