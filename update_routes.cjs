const fs = require('fs');
const path = require('path');

const routesDir = '/Volumes/240GB SSD/Projects/AMAZ-Hospital/Backend/src/routes';

const roleMap = {
  'admin.routes.ts': "['ADMIN']",
  'barcode.routes.ts': "['ALL']",
  'billing.routes.ts': "['ADMIN', 'CASHIER', 'RECEPTIONIST']",
  'booking.routes.ts': "['ALL']",
  'dashboard.routes.ts': "['ADMIN', 'MANAGER']",
  'department.routes.ts': "['ALL']",
  'doctor-attendance.routes.ts': "['ADMIN', 'DOCTOR', 'HR']",
  'extraService.routes.ts': "['ADMIN', 'RECEPTIONIST']",
  'finance.routes.ts': "['ADMIN', 'FINANCE', 'MANAGER']",
  'frontdesk.routes.ts': "['ADMIN', 'RECEPTIONIST']",
  'lab.routes.ts': "['ADMIN', 'LAB_TECH', 'DOCTOR']",
  'patient.routes.ts': "['ALL']",
  'pharmacy.routes.ts': "['ADMIN', 'PHARMACIST', 'DOCTOR']",
  'prescription.routes.ts': "['ADMIN', 'DOCTOR', 'PHARMACIST']",
  'reception.routes.ts': "['ADMIN', 'RECEPTIONIST']",
  'token.routes.ts': "['ALL']"
};

for (const [file, roles] of Object.entries(roleMap)) {
  const filePath = path.join(routesDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Skip if already applied globally in this file
    if (content.includes('router.use(verifyToken, requireRole(')) continue;

    // Remove any existing router.use(verifyToken) so we can replace it
    content = content.replace(/router\.use\(verifyToken\);?\n?/g, '');
    
    // Add imports if missing
    if (!content.includes('requireRole')) {
      if (content.includes('verifyToken')) {
        content = content.replace(/verifyToken(.*)from(.*)auth\.middleware\.js['"]/, 'verifyToken, requireRole $1from$2auth.middleware.js"');
      } else {
        content = `import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";\n` + content;
      }
    }
    
    // Insert router.use
    content = content.replace(/(const router = Router\(\);?)/, `$1\n\nrouter.use(verifyToken, requireRole(${roles}));`);
    
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${file}`);
  }
}
