const fs = require('fs');
let content = fs.readFileSync('prisma/schema.prisma', 'utf8');

// Insert basicSalary and relation arrays if not present
if (!content.includes('basicSalary')) {
    content = content.replace(/  departmentId     String\?\n  isActive/g, '  departmentId     String?\n  basicSalary      Float?\n  isActive');
}
if (!content.includes('Payroll          Payroll[]')) {
    content = content.replace(/  UserShift        CashRegisterShift\[\]\n\}/g, '  UserShift        CashRegisterShift[]\n  StaffAttendance  StaffAttendance[]\n  LeaveRequest     LeaveRequest[]\n  Payroll          Payroll[]\n}');
}
if (!content.includes('model Payroll {')) {
    content += `\nmodel StaffAttendance {
  id          String    @id @default(uuid())
  userId      String
  date        DateTime  @default(now())
  checkIn     DateTime?
  checkOut    DateTime?
  status      String    @default("PRESENT") // PRESENT, LATE, ABSENT
  notes       String?
  user        User      @relation(fields: [userId], references: [id])

  @@unique([userId, date])
}

model LeaveRequest {
  id          String    @id @default(uuid())
  userId      String
  type        String    // SICK, CASUAL, ANNUAL, MATERNITY
  startDate   DateTime
  endDate     DateTime
  reason      String
  status      String    @default("PENDING") // PENDING, APPROVED, REJECTED
  appliedAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id])
}

model Payroll {
  id            String    @id @default(uuid())
  userId        String
  month         Int
  year          Int
  basicSalary   Float
  allowances    Float     @default(0)
  deductions    Float     @default(0)
  netSalary     Float
  status        String    @default("DRAFT") // DRAFT, PAID
  generatedAt   DateTime  @default(now())
  user          User      @relation(fields: [userId], references: [id])

  @@unique([userId, month, year])
}\n`;
}
fs.writeFileSync('prisma/schema.prisma', content);
