import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  console.log('Purging existing data...');
  // We can rely on npx prisma migrate reset for a clean slate,
  // but just in case, we can run deleteMany for important tables
  await prisma.payment.deleteMany({});
  await prisma.refund.deleteMany({});
  await prisma.invoiceLineItem.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.prescription.deleteMany({});
  await prisma.labResult.deleteMany({});
  await prisma.labRequestItem.deleteMany({});
  await prisma.labRequest.deleteMany({});
  await prisma.appointment.deleteMany({});
  await prisma.doctorAttendance.deleteMany({});
  await prisma.doctorScheduleSession.deleteMany({});
  await prisma.extraService.deleteMany({});
  await prisma.stockBatch.deleteMany({});
  await prisma.medicine.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.patient.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.patient.deleteMany({});
  await prisma.labTestBiomarker.deleteMany({});
  await prisma.labTest.deleteMany({});
  
  // --- 1. DEPARTMENTS ---
  console.log('Seeding departments...');
  const deptNames = [
    { name: 'OPD', description: 'Outpatient Department' },
    { name: 'LAB', description: 'Laboratory' },
    { name: 'PHARMACY', description: 'Pharmacy' },
    { name: 'CARDIOLOGY', description: 'Cardiology' },
    { name: 'DENTAL', description: 'Dental Care' },
    { name: 'EXTRA_SERVICES', description: 'Extra Services' },
  ];
  const departments = [];
  for (const d of deptNames) {
    departments.push(
      await prisma.department.upsert({
        where: { name: d.name },
        update: {},
        create: d,
      })
    );
  }

  const opdDept = departments.find(d => d.name === 'OPD');
  const cardioDept = departments.find(d => d.name === 'CARDIOLOGY');
  const dentalDept = departments.find(d => d.name === 'DENTAL');

  // --- 2. ROLES & PERMISSIONS ---
  console.log('Seeding roles and permissions...');
  const permissionsData = [
    { action: 'ALL', resource: 'ALL' },
    { action: 'READ', resource: 'PATIENT' },
    { action: 'CREATE', resource: 'INVOICE' },
    { action: 'UPDATE', resource: 'INVENTORY' },
    { action: 'DELETE', resource: 'MEDICINE' },
  ];

  for (const p of permissionsData) {
    await prisma.permission.upsert({
      where: { action_resource: { action: p.action, resource: p.resource } },
      update: {},
      create: p,
    });
  }

  const roleNames = ['Superadmin', 'Admin', 'Receptionist', 'Doctor', 'Pharmacist', 'LabTech', 'Cashier', 'Nurse'];
  const roles = [];
  for (const name of roleNames) {
    roles.push(
      await prisma.role.upsert({
        where: { name },
        update: {},
        create: { name, description: `${name} Role` },
      })
    );
  }

  // --- 3. USERS (Including clean Doctors & Nurses) ---
  console.log('Seeding users...');
  const salt = await bcrypt.genSalt(10);
  const password = await bcrypt.hash('password123', salt);

  const usersData = [
    { email: 'admin@amaz.com', fullName: 'System Admin', role: 'Superadmin' },
    { email: 'reception@amaz.com', fullName: 'Alice Reception', role: 'Receptionist' },
    { email: 'pharmacy@amaz.com', fullName: 'Bob Pharmacist', role: 'Pharmacist' },
    { email: 'labtech@amaz.com', fullName: 'Charlie Lab', role: 'LabTech' },
    { email: 'cashier@amaz.com', fullName: 'Diana Cashier', role: 'Cashier' },
    { email: 'nurse@amaz.com', fullName: 'Nancy Nurse', role: 'Nurse' },
    // Doctors with precise config
    { 
      email: 'doctor@amaz.com', fullName: 'Dr. John Doe', role: 'Doctor', 
      specialty: 'General', departmentId: opdDept?.id, 
      roomNumber: 'ROOM 1', feeType: 'POST', consultationFee: 2000 
    },
    { 
      email: 'doctor2@amaz.com', fullName: 'Dr. Jane Smith', role: 'Doctor', 
      specialty: 'Cardiology', departmentId: cardioDept?.id, 
      roomNumber: 'ROOM 2', feeType: 'UPFRONT', consultationFee: 3500 
    },
    { 
      email: 'doctor3@amaz.com', fullName: 'Dr. Alice Brown', role: 'Doctor', 
      specialty: 'Dental', departmentId: dentalDept?.id, 
      roomNumber: 'ROOM 3', feeType: 'UPFRONT', consultationFee: 3000 
    },
  ];

  const users = [];
  for (const u of usersData) {
    const role = roles.find((r) => r.name === u.role);
    users.push(
      await prisma.user.upsert({
        where: { email: u.email },
        update: {
          roleId: role!.id,
          departmentId: u.departmentId,
          roomNumber: u.roomNumber,
          feeType: u.feeType || 'POST',
          consultationFee: u.consultationFee,
        },
        create: {
          email: u.email,
          fullName: u.fullName,
          password,
          roleId: role!.id,
          specialty: u.specialty,
          departmentId: u.departmentId,
          roomNumber: u.roomNumber,
          feeType: u.feeType || 'POST',
          consultationFee: u.consultationFee,
        },
      })
    );
  }

  const nurseUser = users.find(u => u.email === 'nurse@amaz.com');
  const doctorUsers = users.filter((u) => u.specialty);

  // --- 4. PATIENTS ---
  console.log('Seeding patients...');
  const patients = [];
  for (let i = 1; i <= 5; i++) {
    patients.push(
      await prisma.patient.create({
        data: {
          fullName: `Patient ${i}`,
          phone: `070000000${i}`,
          ageFallback: 20 + i,
          gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
        },
      })
    );
  }

  // --- 5. INVENTORY & PHARMACY ---
  console.log('Seeding inventory...');
  const suppliers = [];
  for (let i = 1; i <= 5; i++) {
    suppliers.push(
      await prisma.supplier.create({
        data: {
          name: `Supplier ${i}`,
          email: `supplier${i}@example.com`,
          phone: `071000000${i}`,
        },
      })
    );
  }

  const medicines = [];
  for (let i = 1; i <= 5; i++) {
    const med = await prisma.medicine.upsert({
      where: { barcode: `100000000${i}` },
      update: {},
      create: {
        name: `Medicine ${i}`,
        genericName: `Generic ${i}`,
        category: 'Antibiotics',
        form: 'Tablet',
        unit: 'Box',
        barcode: `100000000${i}`,
        reorderLevel: 50,
      }
    });
    medicines.push(med);
  }

  for (let i = 1; i <= 5; i++) {
    await prisma.stockBatch.create({
      data: {
        medicineId: medicines[i - 1].id,
        batchNumber: `BATCH${i}`,
        expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        initialQuantity: 100,
        currentQuantity: 100,
        unitPrice: 15.5 * i,
      },
    });
  }

  // --- 6. EXTRA SERVICES & LAB TESTS ---
  console.log('Seeding extra services and lab tests...');
  const extraServicesData = [
    { title: 'Medical Certificate', price: 500, barcode: '1000000101', roomNumber: 'ROOM 4' },
    { title: 'Wound Dressing', price: 1500, barcode: '1000000102', roomNumber: 'ROOM 4' },
    { title: 'ECG', price: 2000, barcode: '1000000103', roomNumber: 'ROOM 5' },
  ];
  for (const es of extraServicesData) {
    await prisma.extraService.upsert({
      where: { barcode: es.barcode },
      update: {},
      create: es,
    });
  }

  const labTests = [];
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
      biomarkers: [
        { name: "Glucose", unit: "mg/dL", referenceRange: "70 - 99" }
      ]
    }
  ];

  for (const tDef of testDefinitions) {
    const test = await prisma.labTest.create({
      data: {
        name: tDef.name,
        code: tDef.code,
        price: tDef.price,
        category: tDef.category,
        sampleType: tDef.sample,
        biomarkers: {
          create: tDef.biomarkers.map((b, i) => ({
            name: b.name,
            unit: b.unit,
            referenceRange: b.referenceRange,
            category: "NONE",
            orderIndex: i
          }))
        }
      }
    });
    labTests.push(test);
  }

  // --- 7. DOCTOR SCHEDULES, ATTENDANCE & NURSE ASSIGNMENTS ---
  console.log('Seeding doctor schedules and attendance...');
  for (const doc of doctorUsers) {
    const schedule = await prisma.doctorSchedule.create({
      data: {
        doctorId: doc.id,
      },
    });

    const days = [0, 1, 2, 3, 4, 5, 6]; // all days
    for (const day of days) {
      await prisma.doctorScheduleSession.create({
        data: {
          scheduleId: schedule.id,
          dayOfWeek: day,
          sessionName: 'Morning Shift',
          startTime: '08:00',
          endTime: '12:00',
          tokenCapacity: 40,
          walkInPercentage: 100,
          isActive: true
        },
      });
      await prisma.doctorScheduleSession.create({
        data: {
          scheduleId: schedule.id,
          dayOfWeek: day,
          sessionName: 'Evening Shift',
          startTime: '14:00',
          endTime: '18:00',
          tokenCapacity: 40,
          walkInPercentage: 100,
          isActive: true
        },
      });
    }

    await prisma.doctorAttendance.create({
      data: {
        doctorId: doc.id,
        status: 'ARRIVED',
        arrivedAt: new Date(),
        roomNumber: doc.roomNumber,
        assignedNurseId: nurseUser?.id, // Assign the nurse!
        expectedStartTime: "08:00",
        expectedEndTime: "12:00"
      },
    });
  }

  // --- 8. COMPREHENSIVE LAB SEEDING (REQUESTS, RESULTS) ---
  console.log('Seeding Lab Requests and Results...');
  const statuses = ["PENDING", "SAVED", "COMPLETED", "COMPLETED", "COMPLETED"]; 
  const priorities = ["ROUTINE", "ROUTINE", "ROUTINE", "URGENT"];

  for (let i = 0; i < 50; i++) {
    const randomPatient = patients[Math.floor(Math.random() * patients.length)];
    const randomDoctor = doctorUsers[Math.floor(Math.random() * doctorUsers.length)];
    const randomTest = labTests[Math.floor(Math.random() * labTests.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const priority = priorities[Math.floor(Math.random() * priorities.length)];
    
    // Distribute requestedAt over the last 30 days
    const daysAgo = Math.floor(Math.random() * 30);
    const requestedAt = new Date();
    requestedAt.setDate(requestedAt.getDate() - daysAgo);

    const labReq = await prisma.labRequest.create({
      data: {
        patientId: randomPatient.id,
        doctorId: randomDoctor.id,
        status: status,
        priority: priority,
        requestedAt: requestedAt,
        items: {
          create: {
            labTestId: randomTest.id,
            price: randomTest.price
          }
        }
      },
      include: {
        items: { include: { LabTest: { include: { biomarkers: true } } } }
      }
    });

    if (status === "COMPLETED" || status === "SAVED") {
      const isCritical = Math.random() < 0.15; // 15% chance of critical
      
      for (const item of labReq.items) {
        for (const marker of item.LabTest.biomarkers) {
          // Generate a random numeric result
          let val = 0;
          if (marker.name === "Hemoglobin") val = 10 + Math.random() * 8;
          else if (marker.name === "White Blood Cells") val = 3 + Math.random() * 10;
          else if (marker.name === "Platelets") val = 100 + Math.random() * 300;
          else if (marker.name === "Total Cholesterol") val = 150 + Math.random() * 100;
          else if (marker.name === "HDL") val = 30 + Math.random() * 40;
          else if (marker.name === "LDL") val = 80 + Math.random() * 80;
          else if (marker.name === "Glucose") val = 60 + Math.random() * 80;

          if (isCritical) {
            val = val * 1.5; // push out of range
          }

          await prisma.labResult.create({
            data: {
              requestId: labReq.id,
              biomarker: marker.name,
              value: val.toFixed(1),
              referenceRange: marker.referenceRange,
              flag: isCritical ? "H" : "N",
              isOutOfRange: isCritical
            }
          });
        }
      }
    }
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
