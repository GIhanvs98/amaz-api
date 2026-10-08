import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function seedData() {
  console.log("Starting custom seed...");

  // 1. Outsource Lab Tests
  console.log("Seeding Lab Tests...");
  const labTestsFile = '/Volumes/240GB SSD/Projects/AMAZ-Hospital/Amaz Data/OutSource Lab Tests.md';
  const labContent = fs.readFileSync(labTestsFile, 'utf-8');
  const labLines = labContent.split('\n').filter((l: string) => l.includes('|')).slice(2); // Skip header and separator

  for (const line of labLines) {
    const parts = line.split('|').slice(1, -1).map((p: string) => p.trim());
    if (parts.length >= 3) {
      const testName = parts[0];
      const rubimusPrice = parseFloat(parts[1]);
      const asiriPrice = parseFloat(parts[2]);

      if (!isNaN(rubimusPrice)) {
        await prisma.labTest.upsert({
          where: { code: `RUBIMUS_${testName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}` },
          update: { price: rubimusPrice, name: `${testName} (Rubimus)` },
          create: {
            name: `${testName} (Rubimus)`,
            code: `RUBIMUS_${testName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`,
            price: rubimusPrice,
            category: 'Outsourced',
          }
        });
      }

      if (!isNaN(asiriPrice)) {
        await prisma.labTest.upsert({
          where: { code: `ASIRI_${testName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}` },
          update: { price: asiriPrice, name: `${testName} (Asiri)` },
          create: {
            name: `${testName} (Asiri)`,
            code: `ASIRI_${testName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`,
            price: asiriPrice,
            category: 'Outsourced',
          }
        });
      }
    }
  }

  // 2. Inventory
  console.log("Seeding Inventory...");
  const inventoryFile = '/Volumes/240GB SSD/Projects/AMAZ-Hospital/Amaz Data/Inventory.md';
  const invContent = fs.readFileSync(inventoryFile, 'utf-8');
  const invLines = invContent.split('\n').filter((l: string) => l.includes('|')).slice(2);

  for (const line of invLines) {
    const parts = line.split('|').slice(1, -1).map((p: string) => p.trim());
    if (parts.length >= 5) {
      const category = parts[0];
      const name = parts[1];
      const strength = parts[2];
      const stock = parseInt(parts[3]) || 20;
      const price = parseFloat(parts[4]) || 50;
      
      const fullMedicineName = strength ? `${name} ${strength}` : name;
      
      let medicine = await prisma.medicine.findFirst({
        where: { name: fullMedicineName }
      });

      console.log(`Checking medicine: ${fullMedicineName}... Found: ${!!medicine}`);

      if (!medicine) {
        medicine = await prisma.medicine.create({
          data: {
            name: fullMedicineName,
            category: category,
            unit: 'PCS',
            retailPrice: price,
          }
        });
        
        await prisma.stockBatch.create({
          data: {
            medicineId: medicine.id,
            batchNumber: `BATCH_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            initialQuantity: stock,
            currentQuantity: stock,
            unitPrice: price,
            costPrice: price * 0.7, // Estimate cost price
          }
        });
      } else {
         // Update price if medicine exists
         await prisma.medicine.update({
             where: { id: medicine.id },
             data: { retailPrice: price }
         });
      }
      console.log(`Processed ${fullMedicineName}`);
    }
  }

  // 3. Doctors
  console.log("Seeding Doctors...");
  const doctorsFile = '/Volumes/240GB SSD/Projects/AMAZ-Hospital/Amaz Data/doctors.md';
  const docContent = fs.readFileSync(doctorsFile, 'utf-8');
  const docLines = docContent.split('\n').filter((l: string) => l.includes('|')).slice(2);
  
  const doctorRole = await prisma.role.findFirst({ where: { name: 'Doctor' } }) || await prisma.role.findFirst({ where: { name: 'DOCTOR' }});
  
  if (!doctorRole) {
      console.log("Doctor role not found, skipping doctors seeding.");
  } else {
      for (const line of docLines) {
        const parts = line.split('|').slice(1, -1).map((p: string) => p.trim());
        if (parts.length >= 3) {
          const specialty = parts[0];
          const doctorName = parts[1];
          const rawDept = parts[2]; 
          
          let email = parts[3];
          if (!email || email === '[EMAIL_ADDRESS]') {
            const sanitizedName = doctorName.toLowerCase().replace(/[^a-z]/g, '');
            email = `${sanitizedName}@amaz.com`;
          }
          let pass = parts[4];
          if (!pass || pass === 'password123') {
            const sanitizedName = doctorName.toLowerCase().replace(/[^a-z]/g, '');
            pass = `${sanitizedName}@123`;
          }
          
          const passwordHash = await bcrypt.hash(pass, 10);
          
          // Map department
          let mappedDeptName = 'OPD';
          if (rawDept.toLowerCase().includes('consultant')) {
              mappedDeptName = 'Consultant';
          } else if (rawDept.toLowerCase().includes('genaral') || rawDept.toLowerCase().includes('general')) {
              mappedDeptName = 'OPD';
          }
          
          let dept = await prisma.department.findFirst({ where: { name: mappedDeptName }});
          if (!dept) {
              // Try creating it if not exists
              dept = await prisma.department.create({ data: { name: mappedDeptName, description: mappedDeptName } });
          }

          let user = await prisma.user.findFirst({ where: { email } });
          if (!user) {
              await prisma.user.create({
                  data: {
                      fullName: doctorName,
                      email: email,
                      password: passwordHash,
                      roleId: doctorRole.id,
                      specialty: specialty,
                      departmentId: dept.id,
                      consultationFee: 2500,
                  }
              });
          }
        }
      }
  }

  console.log("Custom seed complete!");
}

seedData().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(() => {
  prisma.$disconnect();
});
