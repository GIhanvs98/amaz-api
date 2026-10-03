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
  await prisma.user.deleteMany({});
  await prisma.patient.deleteMany({});
  
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
    medicines.push(
      await prisma.medicine.create({
        data: {
          name: `Medicine ${i}`,
          genericName: `Generic ${i}`,
          category: 'Antibiotics',
          form: 'Tablet',
          unit: 'Box',
          barcode: `100000000${i}`, // 10 digit barcode
          reorderLevel: 50,
        },
      })
    );
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
  for (let i = 1; i <= 5; i++) {
    labTests.push(
      await prisma.labTest.create({
        data: {
          name: `Blood Test ${i}`,
          code: `LAB00${i}`,
          price: 500.0 * i,
          category: 'Blood',
          sampleType: 'Blood',
        },
      })
    );
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
