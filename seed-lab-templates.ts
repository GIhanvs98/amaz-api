import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const labProfiles = [
  {
    name: 'Complete Blood Count (CBC)',
    code: 'CBC01',
    price: 1500,
    category: 'Haematology',
    sampleType: 'EDTA Blood',
    biomarkers: [
      { name: 'TOTAL WHITE CELL COUNT', category: null, unit: '10^9/L', referenceRange: '4.0 - 11.0', orderIndex: 1 },
      // Differential Count
      { name: 'NEUTROPHILS', category: 'DIFFERENTIAL COUNT', unit: '%', referenceRange: '40% - 80%', orderIndex: 2 },
      { name: 'LYMPHOCYTES', category: 'DIFFERENTIAL COUNT', unit: '%', referenceRange: '20% - 40%', orderIndex: 3 },
      { name: 'MONOCYTES', category: 'DIFFERENTIAL COUNT', unit: '%', referenceRange: '02% - 10%', orderIndex: 4 },
      { name: 'EOSINOPHILS', category: 'DIFFERENTIAL COUNT', unit: '%', referenceRange: '01% - 06%', orderIndex: 5 },
      { name: 'BASOPHILS', category: 'DIFFERENTIAL COUNT', unit: '%', referenceRange: '<0.1% - 02%', orderIndex: 6 },
      // Haemoglobin and RBC Parameters
      { name: 'HAEMOGLOBIN', category: 'HAEMOGLOBIN AND RBC PARAMETERS', unit: 'g/dL', referenceRange: '11.8 - 14.8', orderIndex: 7 },
      { name: 'RED BLOOD CELLS', category: 'HAEMOGLOBIN AND RBC PARAMETERS', unit: '10^12/L', referenceRange: '3.8 - 4.8', orderIndex: 8 },
      { name: 'MEAN CELL VOLUME', category: 'HAEMOGLOBIN AND RBC PARAMETERS', unit: 'fL', referenceRange: '76.0 - 96.0', orderIndex: 9 },
      { name: 'HAEMATOCRIT', category: 'HAEMOGLOBIN AND RBC PARAMETERS', unit: 'L/L(%)', referenceRange: '36.0 - 44.0', orderIndex: 10 },
      { name: 'MEAN CELL HAEMOGLOBIN', category: 'HAEMOGLOBIN AND RBC PARAMETERS', unit: 'pg', referenceRange: '27.0 - 33.0', orderIndex: 11 },
      { name: 'M.C.H. CONCENTRATION', category: 'HAEMOGLOBIN AND RBC PARAMETERS', unit: 'g/dL', referenceRange: '32.0 - 36.0', orderIndex: 12 },
      { name: 'RED CELLS DISTRIBUTION WIDTH', category: 'HAEMOGLOBIN AND RBC PARAMETERS', unit: '%', referenceRange: '12.0 - 15.0', orderIndex: 13 },
      { name: 'PLATELET COUNT', category: 'HAEMOGLOBIN AND RBC PARAMETERS', unit: '10^9/L', referenceRange: '150 - 400', orderIndex: 14 }
    ]
  },
  {
    name: 'Lipid Profile',
    code: 'LIP01',
    price: 2500,
    category: 'Biochemistry',
    sampleType: 'Serum / Fasting Blood',
    biomarkers: [
      { name: 'TOTAL CHOLESTEROL', category: null, unit: 'mg/dL', referenceRange: '< 200', orderIndex: 1 },
      { name: 'TRIGLYCERIDES', category: null, unit: 'mg/dL', referenceRange: '< 150', orderIndex: 2 },
      { name: 'HDL CHOLESTEROL', category: null, unit: 'mg/dL', referenceRange: '> 40', orderIndex: 3 },
      { name: 'LDL CHOLESTEROL', category: null, unit: 'mg/dL', referenceRange: '< 100', orderIndex: 4 },
      { name: 'VLDL CHOLESTEROL', category: null, unit: 'mg/dL', referenceRange: '2 - 30', orderIndex: 5 },
      { name: 'CHOL / HDL RATIO', category: 'RATIOS', unit: 'Ratio', referenceRange: '< 5.0', orderIndex: 6 },
      { name: 'LDL / HDL RATIO', category: 'RATIOS', unit: 'Ratio', referenceRange: '< 3.5', orderIndex: 7 }
    ]
  },
  {
    name: 'Liver Function Test (LFT)',
    code: 'LFT02',
    price: 2000,
    category: 'Biochemistry',
    sampleType: 'Serum',
    biomarkers: [
      { name: 'TOTAL PROTEIN', category: null, unit: 'g/dL', referenceRange: '6.4 - 8.3', orderIndex: 1 },
      { name: 'ALBUMIN', category: null, unit: 'g/dL', referenceRange: '3.5 - 5.0', orderIndex: 2 },
      { name: 'GLOBULIN', category: null, unit: 'g/dL', referenceRange: '2.0 - 3.5', orderIndex: 3 },
      { name: 'A/G RATIO', category: null, unit: 'Ratio', referenceRange: '1.2 - 2.2', orderIndex: 4 },
      { name: 'TOTAL BILIRUBIN', category: null, unit: 'mg/dL', referenceRange: '0.2 - 1.2', orderIndex: 5 },
      { name: 'DIRECT BILIRUBIN', category: null, unit: 'mg/dL', referenceRange: '< 0.3', orderIndex: 6 },
      { name: 'INDIRECT BILIRUBIN', category: null, unit: 'mg/dL', referenceRange: '0.2 - 0.8', orderIndex: 7 },
      { name: 'SGOT (AST)', category: 'ENZYMES', unit: 'U/L', referenceRange: '< 40', orderIndex: 8 },
      { name: 'SGPT (ALT)', category: 'ENZYMES', unit: 'U/L', referenceRange: '< 41', orderIndex: 9 },
      { name: 'ALKALINE PHOSPHATASE', category: 'ENZYMES', unit: 'U/L', referenceRange: '40 - 129', orderIndex: 10 },
      { name: 'GAMMA GT', category: 'ENZYMES', unit: 'U/L', referenceRange: '8 - 61', orderIndex: 11 }
    ]
  },
  {
    name: 'Renal Profile / Kidney Function Test',
    code: 'RFT01',
    price: 1800,
    category: 'Biochemistry',
    sampleType: 'Serum',
    biomarkers: [
      { name: 'BLOOD UREA', category: null, unit: 'mg/dL', referenceRange: '15 - 45', orderIndex: 1 },
      { name: 'SERUM CREATININE', category: null, unit: 'mg/dL', referenceRange: '0.7 - 1.4', orderIndex: 2 },
      { name: 'SERUM URIC ACID', category: null, unit: 'mg/dL', referenceRange: '3.5 - 7.2', orderIndex: 3 },
      { name: 'SERUM CALCIUM', category: 'ELECTROLYTES', unit: 'mg/dL', referenceRange: '8.5 - 10.5', orderIndex: 4 },
      { name: 'SERUM PHOSPHORUS', category: 'ELECTROLYTES', unit: 'mg/dL', referenceRange: '2.5 - 4.5', orderIndex: 5 },
      { name: 'SERUM SODIUM (Na+)', category: 'ELECTROLYTES', unit: 'mEq/L', referenceRange: '135 - 145', orderIndex: 6 },
      { name: 'SERUM POTASSIUM (K+)', category: 'ELECTROLYTES', unit: 'mEq/L', referenceRange: '3.5 - 5.1', orderIndex: 7 },
      { name: 'SERUM CHLORIDE (Cl-)', category: 'ELECTROLYTES', unit: 'mEq/L', referenceRange: '98 - 107', orderIndex: 8 }
    ]
  },
  {
    name: 'Thyroid Profile (T3, T4, TSH)',
    code: 'THY01',
    price: 3000,
    category: 'Immunology',
    sampleType: 'Serum',
    biomarkers: [
      { name: 'TOTAL T3', category: null, unit: 'ng/dL', referenceRange: '60 - 200', orderIndex: 1 },
      { name: 'TOTAL T4', category: null, unit: 'ug/dL', referenceRange: '4.5 - 12.0', orderIndex: 2 },
      { name: 'TSH (Ultrasensitive)', category: null, unit: 'uIU/mL', referenceRange: '0.3 - 5.5', orderIndex: 3 }
    ]
  },
  {
    name: 'Urine Full Report (UFR)',
    code: 'UFR01',
    price: 800,
    category: 'Clinical Pathology',
    sampleType: 'Urine',
    biomarkers: [
      { name: 'COLOR', category: 'PHYSICAL EXAMINATION', unit: '', referenceRange: 'PALE YELLOW', orderIndex: 1 },
      { name: 'APPEARANCE', category: 'PHYSICAL EXAMINATION', unit: '', referenceRange: 'CLEAR', orderIndex: 2 },
      { name: 'SPECIFIC GRAVITY', category: 'PHYSICAL EXAMINATION', unit: '', referenceRange: '1.010 - 1.025', orderIndex: 3 },
      { name: 'REACTION (pH)', category: 'CHEMICAL EXAMINATION', unit: '', referenceRange: '5.0 - 8.0', orderIndex: 4 },
      { name: 'PROTEIN (ALBUMIN)', category: 'CHEMICAL EXAMINATION', unit: '', referenceRange: 'NIL', orderIndex: 5 },
      { name: 'SUGAR (GLUCOSE)', category: 'CHEMICAL EXAMINATION', unit: '', referenceRange: 'NIL', orderIndex: 6 },
      { name: 'KETONE BODIES', category: 'CHEMICAL EXAMINATION', unit: '', referenceRange: 'NIL', orderIndex: 7 },
      { name: 'BILIRUBIN', category: 'CHEMICAL EXAMINATION', unit: '', referenceRange: 'NIL', orderIndex: 8 },
      { name: 'UROBILINOGEN', category: 'CHEMICAL EXAMINATION', unit: '', referenceRange: 'NORMAL', orderIndex: 9 },
      { name: 'PUS CELLS', category: 'MICROSCOPIC EXAMINATION', unit: '/HPF', referenceRange: '0 - 5', orderIndex: 10 },
      { name: 'RED BLOOD CELLS', category: 'MICROSCOPIC EXAMINATION', unit: '/HPF', referenceRange: '0 - 2', orderIndex: 11 },
      { name: 'EPITHELIAL CELLS', category: 'MICROSCOPIC EXAMINATION', unit: '/HPF', referenceRange: '0 - 5', orderIndex: 12 },
      { name: 'CASTS', category: 'MICROSCOPIC EXAMINATION', unit: '/LPF', referenceRange: 'NIL', orderIndex: 13 },
      { name: 'CRYSTALS', category: 'MICROSCOPIC EXAMINATION', unit: '/HPF', referenceRange: 'NIL', orderIndex: 14 }
    ]
  },
  {
    name: 'Fasting Blood Sugar (FBS)',
    code: 'FBS01',
    price: 500,
    category: 'Biochemistry',
    sampleType: 'Fasting Blood',
    biomarkers: [
      { name: 'FASTING BLOOD SUGAR (FBS)', category: null, unit: 'mg/dL', referenceRange: '70 - 100', orderIndex: 1 }
    ]
  }
];

async function seed() {
  console.log('Seeding lab test knowledge base...');

  for (const profile of labProfiles) {
    // Check if test exists by code
    const existing = await prisma.labTest.findUnique({ where: { code: profile.code } });
    
    if (existing) {
      console.log(`Test ${profile.code} already exists, updating biomarkers...`);
      // Delete existing biomarkers
      await prisma.labTestBiomarker.deleteMany({ where: { labTestId: existing.id } });
      
      // Re-insert
      await prisma.labTestBiomarker.createMany({
        data: profile.biomarkers.map(b => ({
          ...b,
          labTestId: existing.id
        }))
      });
    } else {
      console.log(`Creating test ${profile.code}...`);
      await prisma.labTest.create({
        data: {
          name: profile.name,
          code: profile.code,
          price: profile.price,
          category: profile.category,
          sampleType: profile.sampleType,
          isActive: true,
          biomarkers: {
            create: profile.biomarkers
          }
        }
      });
    }
  }

  console.log('Knowledge base seeded successfully!');
}

seed().catch(console.error).finally(() => prisma.$disconnect());
