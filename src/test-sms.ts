import axios from 'axios';

const token = "4122|L8sw5AYQglw67U8XOVauolEPRjVBeZH7a3RVE4hi";
const phone = "0768521562";

async function testSMS() {
  try {
    let formattedPhone = phone.trim();
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '94' + formattedPhone.slice(1);
    }
    
    console.log("Sending SMS to", formattedPhone);

    const response = await axios.post(
      'https://app.text.lk/api/v3/sms/send',
      {
        recipient: formattedPhone,
        sender_id: 'AmazHospital',
        type: 'plain',
        message: 'This is a test message from AMAZ Hospital Management System.',
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Response:', response.data);
  } catch (error: any) {
    console.error('Error sending SMS:', error.response?.data || error.message);
  }
}

testSMS();
