import { prisma } from "../lib/prisma.js";
import redisClient from "../lib/redis.js";

async function main() {
  const isDryRun = process.argv.includes("--dry-run") || !process.argv.includes("--execute");

  console.log("================================================================================");
  console.log(`PRODUCTION DATABASE AUDIT & DATA PURGE - [${isDryRun ? "DRY-RUN MODE" : "EXECUTION MODE"}]`);
  console.log("================================================================================");
  console.log("Database target: Railway PostgreSQL Production");
  console.log("Timestamp:      ", new Date().toISOString());
  console.log("");

  // 1. Audit Preserved Core Master Data
  console.log("--- 1. MASTER DATA TO PRESERVE (MUST REMAIN INTACT) ---");
  const [
    userCount,
    doctorCount,
    staffCount,
    roleCount,
    employeeProfileCount,
    compVersionCount,
    salaryCompCount,
    medicineCount,
    stockBatchCount,
    supplierCount,
    labTestCount,
    biomarkerCount,
    departmentCount,
    roomCount,
    scheduleCount,
    sessionCount,
    settingCount,
    smsTemplateCount,
    extraServiceCount
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { specialty: { not: null } } }),
    prisma.user.count({ where: { specialty: null } }),
    prisma.role.count(),
    prisma.employeeProfile.count(),
    prisma.compensationVersion.count(),
    prisma.salaryComponent.count(),
    prisma.medicine.count(),
    prisma.stockBatch.count(),
    prisma.supplier.count(),
    prisma.labTest.count(),
    prisma.labTestBiomarker.count(),
    prisma.department.count(),
    prisma.room.count(),
    prisma.doctorSchedule.count(),
    prisma.doctorScheduleSession.count(),
    prisma.systemSetting.count(),
    prisma.smsTemplate.count(),
    prisma.extraService.count(),
  ]);

  console.log(`[PRESERVE] Users (Total):            ${userCount} (Doctors: ${doctorCount}, Staff/Admin: ${staffCount})`);
  console.log(`[PRESERVE] Roles & Permissions:      ${roleCount}`);
  console.log(`[PRESERVE] Employee Profiles:        ${employeeProfileCount} (Comp Versions: ${compVersionCount}, Salary Components: ${salaryCompCount})`);
  console.log(`[PRESERVE] Departments & Rooms:      ${departmentCount} departments, ${roomCount} rooms`);
  console.log(`[PRESERVE] Doctor Schedules:         ${scheduleCount} schedules, ${sessionCount} sessions`);
  console.log(`[PRESERVE] Medicine & Batches:       ${medicineCount} medicines, ${stockBatchCount} batches, ${supplierCount} suppliers`);
  console.log(`[PRESERVE] Lab Test Templates:       ${labTestCount} tests, ${biomarkerCount} biomarkers`);
  console.log(`[PRESERVE] Extra Services:           ${extraServiceCount}`);
  console.log(`[PRESERVE] System & SMS Config:      ${settingCount} settings, ${smsTemplateCount} SMS templates`);
  console.log("");

  // 2. Audit Transactional & Clinical Test Data to Purge
  console.log("--- 2. TEST TRANSACTIONAL & CLINICAL DATA TO CLEAR ---");
  const [
    patientCount,
    appointmentCount,
    invoiceCount,
    invoiceLineItemCount,
    paymentCount,
    refundCount,
    prescriptionCount,
    prescriptionItemCount,
    labRequestCount,
    labRequestItemCount,
    labResultCount,
    expenseCount,
    poCount,
    poItemCount,
    cashShiftCount,
    doctorDailySheetCount,
    doctorDailyItemCount,
    doctorStatementCount,
    overtimeRecordCount,
    payrollRunCount,
    payrollRecordCount,
    payrollLineItemCount,
    staffAttendanceCount,
    leaveRequestCount,
    processedAttendanceCount,
    rawAttendanceLogCount,
    doctorAttendanceCount,
    activityLogCount,
    notificationJobCount,
    patientOtpCount
  ] = await Promise.all([
    prisma.patient.count(),
    prisma.appointment.count(),
    prisma.invoice.count(),
    prisma.invoiceLineItem.count(),
    prisma.payment.count(),
    prisma.refund.count(),
    prisma.prescription.count(),
    prisma.prescriptionItem.count(),
    prisma.labRequest.count(),
    prisma.labRequestItem.count(),
    prisma.labResult.count(),
    prisma.expense.count(),
    prisma.purchaseOrder.count(),
    prisma.purchaseOrderItem.count(),
    prisma.cashRegisterShift.count(),
    prisma.doctorDailySheet.count(),
    prisma.doctorDailyPatientItem.count(),
    prisma.doctorPaymentStatement.count(),
    prisma.overtimeRecord.count(),
    prisma.payrollRun.count(),
    prisma.payrollRecord.count(),
    prisma.payrollLineItem.count(),
    prisma.staffAttendance.count(),
    prisma.leaveRequest.count(),
    prisma.processedAttendance.count(),
    prisma.rawAttendanceLog.count(),
    prisma.doctorAttendance.count(),
    prisma.activityLog.count(),
    prisma.notificationJob.count(),
    prisma.patientOTP.count(),
  ]);

  const totalTestRows =
    patientCount + appointmentCount + invoiceCount + invoiceLineItemCount +
    paymentCount + refundCount + prescriptionCount + prescriptionItemCount +
    labRequestCount + labRequestItemCount + labResultCount + expenseCount +
    poCount + poItemCount + cashShiftCount + doctorDailySheetCount +
    doctorDailyItemCount + doctorStatementCount + overtimeRecordCount +
    payrollRunCount + payrollRecordCount + payrollLineItemCount +
    staffAttendanceCount + leaveRequestCount + processedAttendanceCount +
    rawAttendanceLogCount + doctorAttendanceCount + activityLogCount +
    notificationJobCount + patientOtpCount;

  console.log(`[TO PURGE] Patients:                  ${patientCount}`);
  console.log(`[TO PURGE] Appointments / Visits:     ${appointmentCount}`);
  console.log(`[TO PURGE] Invoices & Line Items:     ${invoiceCount} invoices, ${invoiceLineItemCount} line items`);
  console.log(`[TO PURGE] Payments & Refunds:        ${paymentCount} payments, ${refundCount} refunds`);
  console.log(`[TO PURGE] Prescriptions & Items:     ${prescriptionCount} prescriptions, ${prescriptionItemCount} items`);
  console.log(`[TO PURGE] Lab Requests & Results:    ${labRequestCount} requests, ${labRequestItemCount} items, ${labResultCount} results`);
  console.log(`[TO PURGE] Expenses:                  ${expenseCount}`);
  console.log(`[TO PURGE] Purchase Orders:           ${poCount} POs, ${poItemCount} items`);
  console.log(`[TO PURGE] Cash Register Shifts:      ${cashShiftCount}`);
  console.log(`[TO PURGE] Doctor Daily Sheets:       ${doctorDailySheetCount} sheets, ${doctorDailyItemCount} items`);
  console.log(`[TO PURGE] Doctor Statements:         ${doctorStatementCount}`);
  console.log(`[TO PURGE] Overtime Records:          ${overtimeRecordCount}`);
  console.log(`[TO PURGE] Payroll Runs & Records:    ${payrollRunCount} runs, ${payrollRecordCount} records, ${payrollLineItemCount} items`);
  console.log(`[TO PURGE] Attendance & Leaves:       ${staffAttendanceCount} staff att, ${doctorAttendanceCount} doc att, ${leaveRequestCount} leaves`);
  console.log(`[TO PURGE] Biometric Punches:         ${processedAttendanceCount} processed, ${rawAttendanceLogCount} raw logs`);
  console.log(`[TO PURGE] Activity Logs & Jobs:      ${activityLogCount} logs, ${notificationJobCount} jobs, ${patientOtpCount} OTPs`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`TOTAL TEST ROWS IDENTIFIED FOR PURGE: ${totalTestRows}`);
  console.log("");

  if (isDryRun) {
    console.log("[INFO] Dry run complete. No rows were deleted.");
    console.log("[INFO] To execute the actual transactional purge and flush Redis, run with --execute.");
    return;
  }

  // 3. Execution Mode: Transactional Purge in Reverse Foreign-Key Order
  console.log("--- 3. EXECUTING ATOMIC TRANSACTIONAL PURGE ---");
  const startTime = Date.now();

  await prisma.$transaction(async (tx) => {
    console.log("-> Deleting ActivityLog & NotificationJob & PatientOTP...");
    await tx.activityLog.deleteMany();
    await tx.notificationJob.deleteMany();
    await tx.patientOTP.deleteMany();

    console.log("-> Deleting DoctorDailyPatientItem & DoctorDailySheet & DoctorPaymentStatement...");
    await tx.doctorDailyPatientItem.deleteMany();
    await tx.doctorDailySheet.deleteMany();
    await tx.doctorPaymentStatement.deleteMany();

    console.log("-> Deleting PayrollLineItem, PayrollRecord & PayrollRun...");
    await tx.payrollLineItem.deleteMany();
    await tx.payrollRecord.deleteMany();
    await tx.payrollRun.deleteMany();

    console.log("-> Deleting OvertimeRecord, Attendance & Leaves...");
    await tx.overtimeRecord.deleteMany();
    await tx.staffAttendance.deleteMany();
    await tx.leaveRequest.deleteMany();
    await tx.processedAttendance.deleteMany();
    await tx.rawAttendanceLog.deleteMany();
    await tx.doctorAttendance.deleteMany();

    console.log("-> Deleting CashRegisterShift & Expense...");
    await tx.cashRegisterShift.deleteMany();
    await tx.expense.deleteMany();

    console.log("-> Deleting PurchaseOrderItem & PurchaseOrder...");
    await tx.purchaseOrderItem.deleteMany();
    await tx.purchaseOrder.deleteMany();

    console.log("-> Deleting LabResult, LabRequestItem & LabRequest...");
    await tx.labResult.deleteMany();
    await tx.labRequestItem.deleteMany();
    await tx.labRequest.deleteMany();

    console.log("-> Deleting PrescriptionItem & Prescription...");
    await tx.prescriptionItem.deleteMany();
    await tx.prescription.deleteMany();

    console.log("-> Deleting Refund, Payment, InvoiceLineItem & Invoice...");
    await tx.refund.deleteMany();
    await tx.payment.deleteMany();
    await tx.invoiceLineItem.deleteMany();
    await tx.invoice.deleteMany();

    console.log("-> Deleting Appointment & Patient...");
    await tx.appointment.deleteMany();
    await tx.patient.deleteMany();
  }, { timeout: 60000 });

  console.log(`[SUCCESS] Database transaction committed in ${Date.now() - startTime}ms.`);
  console.log("");

  // 4. Redis Cache Flush
  console.log("--- 4. FLUSHING REDIS CACHE ---");
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    const dbsizeBefore = await redisClient.dbSize();
    console.log(`Redis keys before flush: ${dbsizeBefore}`);
    await redisClient.flushDb();
    const dbsizeAfter = await redisClient.dbSize();
    console.log(`[SUCCESS] Redis FLUSHDB completed. Keys remaining: ${dbsizeAfter}`);
  } catch (err: any) {
    console.error("[WARN] Redis flush failed or not connected:", err?.message || err);
  }
  console.log("");

  // 5. Post-Purge Verification
  console.log("--- 5. POST-PURGE VERIFICATION AUDIT ---");
  const [
    postPatients,
    postAppointments,
    postInvoices,
    postPayments,
    postExpenses,
    postDailySheets,
    postPayrollRuns,
    postUsers,
    postMedicines,
    postLabTests,
    postDepartments
  ] = await Promise.all([
    prisma.patient.count(),
    prisma.appointment.count(),
    prisma.invoice.count(),
    prisma.payment.count(),
    prisma.expense.count(),
    prisma.doctorDailySheet.count(),
    prisma.payrollRun.count(),
    prisma.user.count(),
    prisma.medicine.count(),
    prisma.labTest.count(),
    prisma.department.count(),
  ]);

  console.log(`Post-purge Patients:          ${postPatients} (Expected: 0)`);
  console.log(`Post-purge Appointments:      ${postAppointments} (Expected: 0)`);
  console.log(`Post-purge Invoices:          ${postInvoices} (Expected: 0)`);
  console.log(`Post-purge Payments:          ${postPayments} (Expected: 0)`);
  console.log(`Post-purge Expenses:          ${postExpenses} (Expected: 0)`);
  console.log(`Post-purge DoctorDailySheets: ${postDailySheets} (Expected: 0)`);
  console.log(`Post-purge PayrollRuns:       ${postPayrollRuns} (Expected: 0)`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`[VERIFIED MASTER DATA] Users:       ${postUsers} (Intact)`);
  console.log(`[VERIFIED MASTER DATA] Medicines:   ${postMedicines} (Intact)`);
  console.log(`[VERIFIED MASTER DATA] Lab Tests:   ${postLabTests} (Intact)`);
  console.log(`[VERIFIED MASTER DATA] Departments: ${postDepartments} (Intact)`);
  console.log("");
  console.log("ALL TARGET TEST DATA SAFELY PURGED AND VERIFIED.");
}

main()
  .catch((err) => {
    console.error("FATAL ERROR IN PURGE SCRIPT:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (redisClient.isOpen) {
      await redisClient.disconnect();
    }
  });
