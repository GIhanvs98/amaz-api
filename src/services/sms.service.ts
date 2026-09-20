import axios from 'axios';

export class SMSService {
  private static API_URL = 'https://sms.send.lk/api/v3/sms/send';
  private static CONTACTS_API_URL = 'https://sms.send.lk/api/v3/contacts';
  private static API_KEY = process.env.SENDLK_API_KEY || '';
  private static SENDER_ID = process.env.SENDLK_SENDER_ID || '';
  private static GROUP_ID = process.env.SENDLK_GROUP_ID || 'HOSPITAL_PATIENTS';

  /**
   * Sends an SMS via Send.lk
   * @param to Phone number starting with 94
   * @param message Message body
   */
  public static async sendSMS(to: string, message: string): Promise<boolean> {
    if (!this.API_KEY) {
      console.warn('SMS skipped: SENDLK_API_KEY is not defined in environment variables.');
      return false;
    }

    try {
      // Clean phone number: replace leading 0 with 94 if needed
      let formattedPhone = to.trim();
      if (formattedPhone.startsWith('0')) {
        formattedPhone = '94' + formattedPhone.slice(1);
      }

      const response = await axios.post(
        this.API_URL,
        {
          recipient: formattedPhone,
          sender_id: this.SENDER_ID,
          message: message,
        },
        {
          headers: {
            Authorization: `Bearer ${this.API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data && response.data.status === 'error') {
        console.error('Send.lk SMS Gateway Error:', response.data.message);
        return false;
      }

      console.log('SMS sent successfully:', response.data);
      return true;
    } catch (error) {
      console.error('Error sending SMS:', error);
      return false;
    }
  }

  /**
   * Sends the queue token SMS based on the provided template
   */
  public static async sendTokenSMS(
    phone: string,
    refNo: string,
    doctorName: string,
    queueNumber: string,
    hospitalName: string
  ): Promise<boolean> {
    const date = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
    const time = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).toLowerCase(); // 6:18 pm

    const message = `Ref No: ${refNo}
Prof. ${doctorName}
No: ${queueNumber}
Hospital: ${hospitalName}
Date: ${date}
Time: ${time}`;

    return this.sendSMS(phone, message);
  }

  /**
   * Syncs a patient as a Contact in Send.lk
   * @param phone Patient's phone number
   * @param fullName Patient's full name
   */
  public static async syncContact(phone: string, fullName: string): Promise<boolean> {
    if (!this.API_KEY) return false;

    try {
      let formattedPhone = phone.trim();
      if (formattedPhone.startsWith('0')) {
        formattedPhone = '94' + formattedPhone.slice(1);
      }

      // Split full name into first and last
      const nameParts = fullName.trim().split(' ');
      const firstName = nameParts[0] || 'Unknown';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

      const response = await axios.post(
        `${this.CONTACTS_API_URL}/${this.GROUP_ID}/store`,
        {
          phone: parseInt(formattedPhone, 10),
          first_name: firstName,
          last_name: lastName
        },
        {
          headers: {
            Authorization: `Bearer ${this.API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data && response.data.status === 'error') {
        console.error('Send.lk Contact Sync Error:', response.data.message);
        return false;
      }

      console.log('Contact synced successfully:', response.data);
      return true;
    } catch (error) {
      console.error('Error syncing contact:', error);
      return false;
    }
  }
}
