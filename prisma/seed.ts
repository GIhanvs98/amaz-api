import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const firstNames = ['John', 'Jane', 'Michael', 'Emily', 'David', 'Sarah', 'James', 'Emma', 'Robert', 'Olivia', 'William', 'Sophia', 'Joseph', 'Isabella', 'Charles', 'Mia', 'Thomas', 'Charlotte', 'Daniel', 'Amelia', 'Kamal', 'Nimal', 'Sunil', 'Amara', 'Saman'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Perera', 'Silva', 'Fernando', 'De Silva', 'Bandara'];

function getRandomName() {
  return `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
}

async function main() {
  console.log('Starting comprehensive seed...');
  console.log('Purging existing data...');
  
  // Clear all data
  const tableNames = [
    'SystemSetting', 'ExtraService', 'ActivityLog', 'NotificationJob', 'SmsTemplate',
    'DoctorLeave', 'DoctorScheduleException', 'DoctorScheduleSession', 'DoctorSchedule',
    'DoctorAttendance', 'PrescriptionItem', 'Prescription', 'Refund', 'Payment',
    'InvoiceLineItem', 'Invoice', 'LabResult', 'LabRequestItem', 'LabRequest',
    'Appointment', 'PurchaseOrderItem', 'PurchaseOrder', 'StockBatch', 'Supplier',
    'Medicine', 'LabTestBiomarker', 'LabTest', 'Patient', 'User', 'RolePermission',
    'Role', 'Permission', 'Department', 'Expense'
  ];
  
  for (const tableName of tableNames) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tableName}" CASCADE;`);
    } catch (e) {
      console.log(`Failed to truncate ${tableName}, skipping...`);
    }
  }

  // --- DEPARTMENTS ---
  console.log('Seeding departments...');
  const deptNames = [
    { name: 'OPD', description: 'Outpatient Department' },
    { name: 'LAB', description: 'Laboratory' },
    { name: 'PHARMACY', description: 'Pharmacy' },
    { name: 'CARDIOLOGY', description: 'Cardiology' },
    { name: 'DENTAL', description: 'Dental Care' },
    { name: 'EXTRA_SERVICES', description: 'Extra Services' },
    { name: 'NEUROLOGY', description: 'Neurology' },
    { name: 'ORTHOPEDICS', description: 'Orthopedics' },
    { name: 'PEDIATRICS', description: 'Pediatrics' },
    { name: 'DERMATOLOGY', description: 'Dermatology' },
  ];
  const departments = await Promise.all(
    deptNames.map(d => prisma.department.create({ data: d }))
  );
  
  // --- ROLES & PERMISSIONS ---
  console.log('Seeding roles and permissions...');
  const permissionsData = [
    { action: 'ALL', resource: 'ALL' },
    { action: 'READ', resource: 'PATIENT' },
    { action: 'CREATE', resource: 'INVOICE' },
  ];
  await Promise.all(permissionsData.map(p => prisma.permission.create({ data: p })));

  const roleNames = ['Superadmin', 'Admin', 'Receptionist', 'Doctor', 'Pharmacist', 'LabTech', 'Cashier', 'Nurse'];
  const roles = await Promise.all(roleNames.map(name => prisma.role.create({ data: { name, description: `${name} Role` } })));

  // --- USERS ---
  console.log('Seeding users & staff...');
  const salt = await bcrypt.genSalt(10);
  const password = await bcrypt.hash('password123', salt);

  const staffUsersData = [
    { email: 'admin@amaz.com', fullName: 'System Admin', role: 'Superadmin' },
    { email: 'reception@amaz.com', fullName: 'Alice Reception', role: 'Receptionist' },
    { email: 'labtech@amaz.com', fullName: 'Charlie Lab', role: 'LabTech' },
    { email: 'nurse@amaz.com', fullName: 'Nancy Nurse', role: 'Nurse' },
  ];

  await Promise.all(staffUsersData.map(u => {
    const role = roles.find(r => r.name === u.role);
    return prisma.user.create({ data: { email: u.email, fullName: u.fullName, password, roleId: role!.id } });
  }));

  // Create 1 Doctor
  const doctorRole = roles.find(r => r.name === 'Doctor');
  const doctors = [];
  const doctorSpecialties = ['General', 'Cardiology', 'Dental', 'Neurology', 'Orthopedics', 'Pediatrics', 'Dermatology'];
  
  for (let i = 1; i <= 1; i++) {
    const spec = doctorSpecialties[i % doctorSpecialties.length];
    const dept = departments.find(d => d.name === (spec === 'General' ? 'OPD' : spec.toUpperCase()));
    const doc = await prisma.user.create({
      data: {
        email: `dr${i}@amaz.com`,
        fullName: `Dr. ${getRandomName()}`,
        password,
        roleId: doctorRole!.id,
        specialty: spec,
        departmentId: dept?.id || departments[0].id,
        roomNumber: `ROOM ${i}`,
        feeType: i % 2 === 0 ? 'UPFRONT' : 'POST',
        consultationFee: 2000 + (Math.floor(Math.random() * 4) * 500)
      }
    });
    doctors.push(doc);
  }

  const nurseUser = await prisma.user.findFirst({ where: { email: 'nurse@amaz.com' } });

  // --- PATIENTS ---
  console.log('Seeding 10 patients...');
  const patients = [];
  for (let i = 1; i <= 10; i++) {
    const phone = `07${Math.floor(10000000 + Math.random() * 90000000)}`;
    try {
      const p = await prisma.patient.create({
        data: {
          fullName: getRandomName(),
          phone,
          ageFallback: 10 + Math.floor(Math.random() * 60),
          gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
          bloodGroup: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'][i % 8],
          address: `${Math.floor(Math.random() * 100)} Main Street, City`,
        }
      });
      patients.push(p);
    } catch (e) {
      // ignore duplicate phone
    }
  }

  // --- INVENTORY & PHARMACY ---
  console.log('Seeding inventory (50 Medicines)...');
  const suppliers = [];
  for (let i = 1; i <= 5; i++) {
    suppliers.push(
      await prisma.supplier.create({
        data: { name: `Supplier ${i}`, email: `supplier${i}@example.com`, phone: `071000000${i}` }
      })
    );
  }

  const medicineCategories = ['Antibiotics', 'Painkillers', 'Vitamins', 'Cardiac', 'Diabetic'];
  const units = ['Box', 'Bottle', 'Strip', 'Tube'];
  const medicines = [];
  
  for (let i = 1; i <= 50; i++) {
    const med = await prisma.medicine.create({
      data: {
        name: `MedProduct ${i}`,
        genericName: `GenericMed ${i}`,
        category: medicineCategories[i % medicineCategories.length],
        form: 'Tablet',
        unit: units[i % units.length],
        barcode: `1000000${i.toString().padStart(3, '0')}`,
        reorderLevel: 20,
      }
    });
    medicines.push(med);
  }

  for (const med of medicines) {
    // 2 batches per medicine
    for (let b = 1; b <= 2; b++) {
      await prisma.stockBatch.create({
        data: {
          medicineId: med.id,
          batchNumber: `B-${med.id.substring(0,4)}-${b}`,
          expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + b)),
          initialQuantity: 200,
          currentQuantity: Math.floor(Math.random() * 200) + 10,
          unitPrice: 10 + Math.floor(Math.random() * 50),
        }
      });
    }
  }

  // --- LAB TESTS & EXTRA SERVICES ---
  console.log('Seeding Lab Tests and Extra Services...');
  const extraServicesData = [
    { title: 'Medical Certificate', price: 500, barcode: 'SRV-001', roomNumber: 'ROOM 4' },
    { title: 'Wound Dressing', price: 1500, barcode: 'SRV-002', roomNumber: 'ROOM 4' },
    { title: 'ECG', price: 2000, barcode: 'SRV-003', roomNumber: 'ROOM 5' },
    { title: 'X-Ray (Chest)', price: 2500, barcode: 'SRV-004', roomNumber: 'ROOM 6' },
    { title: 'Nebulization', price: 1000, barcode: 'SRV-005', roomNumber: 'ROOM 4' },
  ];
  await Promise.all(extraServicesData.map(es => prisma.extraService.create({ data: es })));

  const testDefinitions = [
    { name: "Full Blood Count (FBC)", code: "LAB-FBC", price: 1500, category: "Hematology", sample: "Blood",
      biomarkers: [
        { name: "Hemoglobin", unit: "g/dL", referenceRange: "13.0 - 17.0" },
        { name: "White Blood Cells", unit: "x10^9/L", referenceRange: "4.0 - 10.0" },
        { name: "Platelets", unit: "x10^9/L", referenceRange: "150 - 400" }
      ]
    },
    { name: "Lipid Profile", code: "LAB-LIP", price: 2500, category: "Biochemistry", sample: "Blood",
      biomarkers: [
        { name: "Total Cholesterol", unit: "mg/dL", referenceRange: "< 200" },
        { name: "HDL", unit: "mg/dL", referenceRange: "> 40" },
        { name: "LDL", unit: "mg/dL", referenceRange: "< 100" }
      ]
    },
    { name: "Fasting Blood Sugar (FBS)", code: "LAB-FBS", price: 500, category: "Biochemistry", sample: "Blood",
      biomarkers: [{ name: "Glucose", unit: "mg/dL", referenceRange: "70 - 99" }]
    },
    { name: "Liver Function Test (LFT)", code: "LAB-LFT", price: 2200, category: "Biochemistry", sample: "Blood",
      biomarkers: [
        { name: "SGPT", unit: "U/L", referenceRange: "7 - 56" },
        { name: "SGOT", unit: "U/L", referenceRange: "8 - 45" },
        { name: "Bilirubin", unit: "mg/dL", referenceRange: "0.1 - 1.2" }
      ]
    },
    { name: "Urine Full Report", code: "LAB-UFR", price: 800, category: "Clinical Pathology", sample: "Urine",
      biomarkers: [
        { name: "Pus Cells", unit: "/HPF", referenceRange: "0 - 5" },
        { name: "Red Cells", unit: "/HPF", referenceRange: "0 - 2" }
      ]
    }
  ];

  const labTests = [];
  for (const tDef of testDefinitions) {
    const test = await prisma.labTest.create({
      data: {
        name: tDef.name, code: tDef.code, price: tDef.price, category: tDef.category, sampleType: tDef.sample,
        biomarkers: {
          create: tDef.biomarkers.map((b, i) => ({
            name: b.name, unit: b.unit, referenceRange: b.referenceRange, orderIndex: i
          }))
        }
      }
    });
    labTests.push(test);
  }

  // --- DOCTOR SCHEDULES, SESSIONS, AND ATTENDANCE ---
  console.log('Seeding schedules and sessions for doctors...');
  const sessions = [];
  
  for (const doc of doctors) {
    const schedule = await prisma.doctorSchedule.create({ data: { doctorId: doc.id } });
    
    // Create sessions for all days
    for (let day = 0; day <= 6; day++) {
      const s1 = await prisma.doctorScheduleSession.create({
        data: { scheduleId: schedule.id, dayOfWeek: day, sessionName: 'Morning', startTime: '08:00', endTime: '12:00', tokenCapacity: 30, walkInPercentage: 80 }
      });
      const s2 = await prisma.doctorScheduleSession.create({
        data: { scheduleId: schedule.id, dayOfWeek: day, sessionName: 'Evening', startTime: '16:00', endTime: '20:00', tokenCapacity: 30, walkInPercentage: 80 }
      });
      sessions.push(s1, s2);
    }
    
    // Mark attendance for today
    await prisma.doctorAttendance.create({
      data: {
        doctorId: doc.id,
        status: 'ARRIVED',
        arrivedAt: new Date(),
        roomNumber: doc.roomNumber,
        assignedNurseId: nurseUser?.id,
        expectedStartTime: "08:00",
        expectedEndTime: "12:00"
      }
    });
  }

  // --- APPOINTMENTS, PRESCRIPTIONS, LAB REQUESTS & INVOICES ---
  console.log('Seeding 10 Appointments with full lifecycles...');
  
  // We want appointments spread over the past 7 days, today, and next 7 days
  const today = new Date();
  
  for (let i = 0; i < 10; i++) {
    const isPast = i < 3;
    const isToday = i >= 3 && i < 7;
    const isFuture = i >= 7;
    
    const doc = doctors[Math.floor(Math.random() * doctors.length)];
    const pat = patients[Math.floor(Math.random() * patients.length)];
    
    // Find a session for this doctor
    const docSchedules = await prisma.doctorSchedule.findFirst({ where: { doctorId: doc.id } });
    const docSessions = await prisma.doctorScheduleSession.findMany({ where: { scheduleId: docSchedules!.id } });
    const session = docSessions[Math.floor(Math.random() * docSessions.length)];
    
    const apptDate = new Date(today);
    if (isPast) apptDate.setDate(today.getDate() - Math.floor(Math.random() * 7) - 1);
    else if (isFuture) apptDate.setDate(today.getDate() + Math.floor(Math.random() * 7) + 1);
    
    // Fix day of week for the date to match session
    const diff = (session.dayOfWeek - apptDate.getDay() + 7) % 7;
    apptDate.setDate(apptDate.getDate() + diff);
    
    let status = 'BOOKED';
    if (isPast) status = 'COMPLETED';
    if (isToday) status = ['BOOKED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'][Math.floor(Math.random() * 5)];
    if (isFuture) status = 'BOOKED';

    const tokenNumber = `T-${(Math.floor(Math.random() * session.tokenCapacity) + 1).toString().padStart(2, '0')}`;
    
    try {
      const appt = await prisma.appointment.create({
        data: {
          tokenNumber,
          patientId: pat.id,
          doctorId: doc.id,
          sessionId: session.id,
          department: "CONSULTATION",
          appointmentDate: apptDate,
          status,
          bookingType: Math.random() > 0.5 ? "WALK_IN" : "PHONE",
          bookingReference: `BK-${Math.floor(Math.random() * 1000000)}`,
          bookedAt: new Date(apptDate.getTime() - 86400000),
          checkedInAt: (status !== 'BOOKED' && status !== 'CANCELLED') ? apptDate : null,
          completedAt: status === 'COMPLETED' ? new Date(apptDate.getTime() + 1800000) : null,
        }
      });
      
      // If completed, maybe generate prescription and lab request and invoice
      if (status === 'COMPLETED') {
        const wantsPrescription = Math.random() > 0.3;
        const wantsLab = Math.random() > 0.5;
        
        let totalInvoiceAmount = doc.consultationFee || 0;
        
        const invoiceItems = [{
          department: 'CONSULTATION',
          description: `Consultation - ${doc.fullName}`,
          quantity: 1,
          unitPrice: totalInvoiceAmount,
          total: totalInvoiceAmount,
          referenceId: appt.id
        }];

        if (wantsPrescription) {
          const rx = await prisma.prescription.create({
            data: {
              patientId: pat.id,
              patientName: pat.fullName,
              visitId: appt.id,
              doctorId: doc.id,
              doctorName: doc.fullName,
              status: "COMPLETED",
              diagnosis: "Viral Fever",
              clinicalNotes: "Rest for 3 days",
            }
          });
          
          const numMeds = Math.floor(Math.random() * 3) + 1;
          for (let m = 0; m < numMeds; m++) {
            const med = medicines[Math.floor(Math.random() * medicines.length)];
            const qty = Math.floor(Math.random() * 20) + 5;
            await prisma.prescriptionItem.create({
              data: {
                prescriptionId: rx.id,
                medicineId: med.id,
                drugName: med.name,
                dosage: "1 Tab",
                frequency: "BD",
                duration: "5 Days",
                dispenseQty: qty
              }
            });
            // Approximate price for invoice
            const price = 20 * qty;
            totalInvoiceAmount += price;
            invoiceItems.push({
              department: 'PHARMACY',
              description: med.name,
              quantity: qty,
              unitPrice: 20,
              total: price,
              referenceId: rx.id
            });
          }
        }
        
        if (wantsLab) {
          const t1 = labTests[Math.floor(Math.random() * labTests.length)];
          const lr = await prisma.labRequest.create({
            data: {
              patientId: pat.id,
              doctorId: doc.id,
              visitId: appt.id,
              status: "COMPLETED",
              requestedAt: apptDate,
              items: { create: { labTestId: t1.id, price: t1.price } }
            }
          });
          totalInvoiceAmount += t1.price;
          invoiceItems.push({
            department: 'LABORATORY',
            description: t1.name,
            quantity: 1,
            unitPrice: t1.price,
            total: t1.price,
            referenceId: lr.id
          });
          
          // Generate mock results
          const bms = await prisma.labTestBiomarker.findMany({ where: { labTestId: t1.id } });
          for (const bm of bms) {
            await prisma.labResult.create({
              data: {
                requestId: lr.id,
                biomarker: bm.name,
                value: (Math.random() * 100).toFixed(1),
                referenceRange: bm.referenceRange,
                flag: "N",
                isOutOfRange: false
              }
            });
          }
        }
        
        // Generate Invoice
        const inv = await prisma.invoice.create({
          data: {
            visitId: appt.id,
            patientId: pat.id,
            status: "PAID",
            subtotal: totalInvoiceAmount,
            totalAmount: totalInvoiceAmount,
            lineItems: {
              create: invoiceItems
            }
          }
        });
        
        // Generate Payment
        await prisma.payment.create({
          data: {
            invoiceId: inv.id,
            appointmentId: appt.id,
            amount: totalInvoiceAmount,
            method: ["CASH", "CARD"][Math.floor(Math.random() * 2)],
            status: "COMPLETED",
            transactionRef: `TRX-${Math.floor(Math.random() * 1000000)}`
          }
        });
      }
    } catch (e) {
      // Ignore unique constraint on token for the same session/date
    }
  }

  // --- SYSTEM SETTINGS ---
  console.log('Seeding system settings...');
  const settingsData = [
    { key: 'HOSPITAL_NAME', value: 'AMAZ Hospital' },
    { key: 'CONTACT_EMAIL', value: 'info@amazhospital.com' },
    { key: 'CONTACT_PHONE', value: '0112345678' },
    { key: 'ADDRESS', value: '123 Main Street, Colombo' },
    { key: 'CURRENCY', value: 'LKR' },
    { key: 'APPOINTMENT_CANCELLATION_HOURS', value: '24' },
    { key: 'MAX_WALK_IN_PERCENTAGE', value: '70' }
  ];
  await Promise.all(settingsData.map(s => prisma.systemSetting.upsert({
    where: { key: s.key },
    update: s,
    create: s
  })));

  // --- EXPENSES ---
  console.log('Seeding expenses...');
  const expenseCategories = ['UTILITY', 'SUPPLIES', 'MAINTENANCE', 'SALARY', 'OTHER'];
  for (let i = 0; i < 20; i++) {
    const expDate = new Date();
    expDate.setDate(today.getDate() - Math.floor(Math.random() * 30));
    await prisma.expense.create({
      data: {
        category: expenseCategories[Math.floor(Math.random() * expenseCategories.length)],
        amount: 5000 + (Math.floor(Math.random() * 50000)),
        description: `Expense ${i}`,
        date: expDate
      }
    });
  }
  
  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
