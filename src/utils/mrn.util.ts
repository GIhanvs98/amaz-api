import { PrismaClient } from "@prisma/client";

export async function generateMRN(prismaOrTx: any): Promise<string> {
  // If the passed object doesn't have $transaction, it's already a tx.
  // We will run this inside a transaction to ensure atomic increment.
  const executeLogic = async (tx: any) => {
    // Use row-level locking (Postgres)
    const settings: any[] = await tx.$queryRaw`SELECT value FROM "SystemSetting" WHERE key = 'LAST_MRN' FOR UPDATE`;
    
    let nextNumeric = 10001;

    if (settings.length === 0) {
      // Find current max from patients table
      const lastPatient = await tx.patient.findFirst({
        where: { patientId: { startsWith: "PT-" } },
        orderBy: { createdAt: "desc" },
        select: { patientId: true }
      });
      
      if (lastPatient && lastPatient.patientId) {
         const numericPart = parseInt(lastPatient.patientId.replace("PT-", ""), 10);
         if (!isNaN(numericPart)) {
           nextNumeric = numericPart + 1;
         }
      }
      
      // Initialize setting
      await tx.systemSetting.create({
        data: { key: 'LAST_MRN', value: nextNumeric.toString() }
      });
    } else {
      nextNumeric = parseInt(settings[0].value, 10) + 1;
      await tx.systemSetting.update({
        where: { key: 'LAST_MRN' },
        data: { value: nextNumeric.toString() }
      });
    }
    
    return `PT-${nextNumeric}`;
  };

  if (prismaOrTx.$transaction) {
    return prismaOrTx.$transaction(executeLogic);
  }
  return executeLogic(prismaOrTx);
}
