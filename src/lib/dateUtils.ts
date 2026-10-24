/**
 * Helper to get timezone-aware start of day (midnight) and end of day.
 * If TIMEZONE env var is not set, defaults to Asia/Colombo for AMAZ Hospital.
 */
export function getTimezoneBoundaries(dateInput: Date | string = new Date(), timezone: string = process.env.TIMEZONE || 'Asia/Colombo') {
  let date: Date;
  let yearStr = '';
  let monthStr = '';
  let dayStr = '';

  if (typeof dateInput === 'string') {
    const match = dateInput.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match && match[1] && match[2] && match[3]) {
      yearStr = match[1];
      monthStr = match[2];
      dayStr = match[3];
      // Noon in UTC for this date to avoid edge clipping across timezones
      date = new Date(`${yearStr}-${monthStr}-${dayStr}T12:00:00.000Z`);
    } else {
      date = new Date(dateInput);
    }
  } else {
    date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  }

  if (isNaN(date.getTime())) {
    date = new Date();
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(date);
  const year = yearStr || parts.find(p => p.type === 'year')?.value;
  const month = monthStr || parts.find(p => p.type === 'month')?.value;
  const day = dayStr || parts.find(p => p.type === 'day')?.value;

  const offsetFormatter = new Intl.DateTimeFormat('en-US', { timeZoneName: 'longOffset', timeZone: timezone });
  const offsetStringMatch = offsetFormatter.format(date).match(/GMT([+-]\d{2}:\d{2})/);
  const offsetString = offsetStringMatch ? offsetStringMatch[1] : '+05:30';
  
  const startOfDayTz = new Date(`${year}-${month}-${day}T00:00:00.000${offsetString}`);
  const endOfDayTz = new Date(`${year}-${month}-${day}T23:59:59.999${offsetString}`);
  const firstDayOfMonthTz = new Date(`${year}-${month}-01T00:00:00.000${offsetString}`);

  // Weekday in target timezone (0=Sun, 1=Mon, ..., 6=Sat)
  const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const weekdayStr = weekdayFormatter.format(startOfDayTz);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[weekdayStr] !== undefined ? dayMap[weekdayStr] : startOfDayTz.getDay();

  return {
    startOfDay: startOfDayTz,
    endOfDay: endOfDayTz,
    firstDayOfMonth: firstDayOfMonthTz,
    dayOfWeek
  };
}

/**
 * Returns the day of week (0=Sun, 1=Mon, ..., 6=Sat) in Asia/Colombo for a given date.
 */
export function getColomboDayOfWeek(date: Date | string = new Date()): number {
  return getTimezoneBoundaries(date, 'Asia/Colombo').dayOfWeek;
}
