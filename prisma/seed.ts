import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  // 1. Roles & Permissions
  console.log('Seeding roles and permissions...');
  const permissionsData = [
    { action: 'ALL', resource: 'ALL' },
    { action: 'READ', resource: 'PATIENT' },
    { action: 'CREATE', resource: 'INVOICE' },
    { action: 'UPDATE', resource: 'INVENTORY' },
    { action: 'DELETE', resource: 'MEDICINE' },
  ];

  const permissions = [];
  for (const p of permissionsData) {
    permissions.push(
      await prisma.permission.upsert({
        where: { action_resource: { action: p.action, resource: p.resource } },
        update: {},
        create: p,
      })
    );
  }

  const roleNames = ['Superadmin', 'Admin', 'Receptionist', 'Doctor', 'Pharmacist', 'LabTech', 'Cashier'];
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

  // 2. Users
  console.log('Seeding users...');
  const salt = await bcrypt.genSalt(10);
  const password = await bcrypt.hash('password123', salt);

  const usersData = [
    { email: 'admin@amaz.com', fullName: 'System Admin', role: 'Superadmin' },
    { email: 'reception@amaz.com', fullName: 'Alice Reception', role: 'Receptionist' },
    { email: 'doctor@amaz.com', fullName: 'Dr. John Doe', role: 'Doctor', specialty: 'General' },
    { email: 'pharmacy@amaz.com', fullName: 'Bob Pharmacist', role: 'Pharmacist' },
    { email: 'labtech@amaz.com', fullName: 'Charlie Lab', role: 'LabTech' },
    { email: 'cashier@amaz.com', fullName: 'Diana Cashier', role: 'Cashier' },
    { email: 'doctor2@amaz.com', fullName: 'Dr. Jane Smith', role: 'Doctor', specialty: 'Cardiology' },
  ];

  const users = [];
  for (const u of usersData) {
    const role = roles.find((r) => r.name === u.role);
    users.push(
      await prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: {
          email: u.email,
          fullName: u.fullName,
          password,
          roleId: role!.id,
          specialty: u.specialty,
        },
      })
    );
  }

  // 3. Patients
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

  // 4. Inventory (Suppliers, Medicine, StockBatch)
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
          barcode: `BARCODE${i}`,
          reorderLevel: 50,
        },
      })
    );
  }

  const stockBatches = [];
  for (let i = 1; i <= 5; i++) {
    stockBatches.push(
      await prisma.stockBatch.create({
        data: {
          medicineId: medicines[i - 1].id,
          batchNumber: `BATCH${i}`,
          expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
          initialQuantity: 100,
          currentQuantity: 100,
          unitPrice: 15.5 * i,
        },
      })
    );
  }

  // 5. Purchase Orders
  console.log('Seeding purchase orders...');
  for (let i = 1; i <= 5; i++) {
    await prisma.purchaseOrder.create({
      data: {
        supplierId: suppliers[i - 1].id,
        status: 'COMPLETED',
        totalAmount: 15.5 * i * 50,
        items: {
          create: [
            {
              medicineId: medicines[i - 1].id,
              quantity: 50,
              unitPrice: 15.5 * i,
              totalPrice: 15.5 * i * 50,
            },
          ],
        },
      },
    });
  }

  // 6. Doctor Schedules & Attendance
  console.log('Seeding doctor schedules...');
  const doctorUsers = users.filter((u) => u.specialty);
  for (const doc of doctorUsers) {
    const schedule = await prisma.doctorSchedule.create({
      data: {
        doctorId: doc.id,
      },
    });

    await prisma.doctorScheduleSession.create({
      data: {
        scheduleId: schedule.id,
        dayOfWeek: new Date().getDay(),
        sessionName: 'Morning Shift',
        startTime: '08:00',
        endTime: '12:00',
        tokenCapacity: 20,
      },
    });

    await prisma.doctorAttendance.create({
      data: {
        doctorId: doc.id,
        status: 'ARRIVED',
        arrivedAt: new Date(),
      },
    });
  }

  // 7. Appointments & Lab Requests
  console.log('Seeding appointments & lab requests...');
  const labTests = [];
  for (let i = 1; i <= 5; i++) {
    labTests.push(
      await prisma.labTest.create({
        data: {
          name: `Test ${i}`,
          code: `TEST${i}`,
          price: 50.0 * i,
          category: 'Blood',
          sampleType: 'Blood',
        },
      })
    );
  }

  for (let i = 1; i <= 5; i++) {
    const apt = await prisma.appointment.create({
      data: {
        tokenNumber: `TKN-${i}`,
        patientId: patients[i - 1].id,
        doctorId: doctorUsers[0].id,
        status: 'COMPLETED',
      },
    });

    const labReq = await prisma.labRequest.create({
      data: {
        patientId: patients[i - 1].id,
        doctorId: doctorUsers[0].id,
        visitId: apt.id,
        status: 'COMPLETED',
      },
    });

    await prisma.labRequestItem.create({
      data: {
        labRequestId: labReq.id,
        labTestId: labTests[i - 1].id,
        price: labTests[i - 1].price,
      },
    });

    await prisma.labResult.create({
      data: {
        requestId: labReq.id,
        biomarker: `Marker ${i}`,
        value: `${5 + i} mg/dL`,
      },
    });
  }

  // 8. Prescriptions
  console.log('Seeding prescriptions...');
  for (let i = 1; i <= 5; i++) {
    await prisma.prescription.create({
      data: {
        patientId: patients[i - 1].id,
        patientName: patients[i - 1].fullName,
        visitId: `VISIT-${i}`,
        doctorId: doctorUsers[0].id,
        doctorName: doctorUsers[0].fullName,
        status: 'DISPENSED',
        items: {
          create: [
            {
              medicineId: medicines[i - 1].id,
              drugName: medicines[i - 1].name,
              dispenseQty: 2,
            },
          ],
        },
      },
    });
  }

  // 9. Finance (Invoices, Payments, Refunds, Expenses)
  console.log('Seeding finance records...');
  for (let i = 1; i <= 5; i++) {
    const inv = await prisma.invoice.create({
      data: {
        patientId: patients[i - 1].id,
        status: 'PAID',
        subtotal: 100 * i,
        totalAmount: 100 * i,
        lineItems: {
          create: [
            {
              department: 'Consultation',
              description: 'General Visit',
              unitPrice: 100 * i,
              total: 100 * i,
            },
          ],
        },
      },
    });

    const payment = await prisma.payment.create({
      data: {
        invoiceId: inv.id,
        amount: 100 * i,
        method: 'CASH',
        status: 'COMPLETED',
      },
    });

    if (i === 5) {
      await prisma.refund.create({
        data: {
          paymentId: payment.id,
          amount: 50,
          reason: 'Overcharged',
        },
      });
    }

    await prisma.expense.create({
      data: {
        category: 'Utilities',
        amount: 20 * i,
        description: 'Electricity Bill',
      },
    });
  }

  // 10. SMS Templates
  console.log('Seeding SMS templates...');
  for (let i = 1; i <= 5; i++) {
    await prisma.smsTemplate.create({
      data: {
        name: `Template ${i}`,
        content: `Hello, this is template ${i}.`,
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
