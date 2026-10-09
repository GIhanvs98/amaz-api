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
        // roomNumber: `ROOM ${i}`,
        feeType: i % 2 === 0 ? 'UPFRONT' : 'POST',
        consultationFee: 2000 + (Math.floor(Math.random() * 4) * 500)
      }
    });
    doctors.push(doc);
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
