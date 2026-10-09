/**
 * Helper to get timezone-aware start of day (midnight) and end of day.
 * If TIMEZONE env var is not set, defaults to Asia/Colombo for AMAZ Hospital.
 */
export function getTimezoneBoundaries(date: Date = new Date(), timezone: string = process.env.TIMEZONE || 'Asia/Colombo') {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;

  const offsetFormatter = new Intl.DateTimeFormat('en-US', { timeZoneName: 'longOffset', timeZone: timezone });
  const offsetStringMatch = offsetFormatter.format(date).match(/GMT([+-]\d{2}:\d{2})/);
  const offsetString = offsetStringMatch ? offsetStringMatch[1] : 'Z';
  
  const startOfDayTz = new Date(`${year}-${month}-${day}T00:00:00.000${offsetString}`);
  const endOfDayTz = new Date(`${year}-${month}-${day}T23:59:59.999${offsetString}`);

  const firstDayOfMonthTz = new Date(`${year}-${month}-01T00:00:00.000${offsetString}`);

  return {
    startOfDay: startOfDayTz,
    endOfDay: endOfDayTz,
    firstDayOfMonth: firstDayOfMonthTz
  };
}
