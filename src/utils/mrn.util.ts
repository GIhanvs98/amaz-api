import { PrismaClient } from "@prisma/client";

export async function generateMRN(tx: any): Promise<string> {
  // Query the most recently created patient with a PT- prefix
  const lastPatient = await tx.patient.findFirst({
    where: {
      patientId: {
        startsWith: "PT-",
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      patientId: true,
    },
  });

  if (!lastPatient || !lastPatient.patientId) {
    return "PT-10001";
  }

  const numericPart = parseInt(lastPatient.patientId.replace("PT-", ""), 10);
  if (isNaN(numericPart)) {
    // Fallback if there's a malformed PT- string
    return `PT-${Math.floor(10001 + Math.random() * 90000)}`;
  }

  return `PT-${numericPart + 1}`;
}
