import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedDashboard() {
  try {
    console.log("Seeding real data for Dashboard overview...");
    
    // 1. Ensure we have patients
    let patient = await prisma.patient.findFirst();
    if (!patient) {
      patient = await prisma.patient.create({
        data: {
          fullName: "John Doe",
          dateOfBirth: new Date("1980-01-01"),
          gender: "Male",
          contactNumber: "0771234567"
        }
      });
    }

    // 2. Ensure we have doctors
    let doctor = await prisma.user.findFirst({
      where: { Role: { name: "Doctor" } }
    });
    if (!doctor) {
      const role = await prisma.role.findFirst({ where: { name: "Doctor" } });
      if (role) {
        doctor = await prisma.user.create({
          data: {
            fullName: "Dr. Smith",
            email: "dr.smith@amaz.com",
            password: "hashedpassword",
            specialty: "Cardiology",
            roleId: role.id
          }
        });
      }
    }

    if (!doctor) {
      console.log("No doctor found, skipping doctor dependent seeds.");
      return;
    }

    // 3. Appointments (Today and Yesterday)
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    await prisma.appointment.createMany({
      data: [
        {
          patientId: patient.id,
          doctorId: doctor.id,
          appointmentDate: today,
          status: "BOOKED",
          department: "Cardiology",
          tokenNumber: "A001",
          bookingType: "WALK_IN"
        },
        {
          patientId: patient.id,
          doctorId: doctor.id,
          appointmentDate: today,
          status: "COMPLETED",
          department: "Neurology",
          tokenNumber: "N002",
          bookingType: "WALK_IN"
        },
        {
          patientId: patient.id,
          doctorId: doctor.id,
          appointmentDate: yesterday,
          status: "COMPLETED",
          department: "Cardiology",
          tokenNumber: "A001",
          bookingType: "PHONE"
        }
      ]
    });

    // 4. Invoices and Payments (Last 7 days)
    // Create one invoice and payment per day for the last 7 days
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      const invoice = await prisma.invoice.create({
        data: {
          patientId: patient.id,
          totalAmount: 1500 * (i + 1), // Varying amounts
          status: "PAID",
          createdAt: date,
          lineItems: {
            create: [
              {
                department: "CONSULTATION",
                description: `Consultation Fee - Day ${i}`,
                quantity: 1,
                unitPrice: 1500 * (i + 1),
                total: 1500 * (i + 1)
              }
            ]
          }
        }
      });

      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: invoice.totalAmount,
          method: i % 2 === 0 ? "CASH" : "CARD",
          status: "COMPLETED",
          createdAt: date
        }
      });
    }

    // 5. Doctor Attendance Today
    await prisma.doctorAttendance.create({
      data: {
        doctorId: doctor.id,
        date: today,
        status: "ARRIVED",
        arrivedAt: today
      }
    });

    console.log("Successfully seeded dashboard data!");
  } catch (error) {
    console.error("Error seeding dashboard data:", error);
  } finally {
    await prisma.$disconnect();
  }
}

seedDashboard();
