/**
 * Utilities for Doctor handling and sorting across AMAZ Hospital
 */

export function isOpdDoctor(doc: { 
  specialty?: string | null; 
  department?: { name?: string | null } | string | null; 
  fullName?: string | null;
  Department?: { name?: string | null } | null;
}): boolean {
  if (!doc) return false;
  const spec = (doc.specialty || "").toUpperCase();
  const deptName = typeof doc.department === "string" 
    ? doc.department.toUpperCase() 
    : (doc.department?.name || doc.Department?.name || "").toUpperCase();
  const name = (doc.fullName || "").toUpperCase();

  return spec.includes("OPD") || deptName.includes("OPD") || name.includes("OPD");
}

export function sortDoctorsWithOpdFirst<T extends { 
  specialty?: string | null; 
  department?: any; 
  Department?: any; 
  fullName?: string | null;
}>(doctors: T[]): T[] {
  if (!Array.isArray(doctors)) return [];
  return [...doctors].sort((a, b) => {
    const aOpd = isOpdDoctor(a);
    const bOpd = isOpdDoctor(b);
    if (aOpd && !bOpd) return -1;
    if (!aOpd && bOpd) return 1;
    return (a.fullName || "").localeCompare(b.fullName || "");
  });
}
