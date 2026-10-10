import axios from 'axios';

const token = "8182|Pv9pJxIfBetUYDRWVeOT1RXX3yU3l3lDOu1pj4f522c44ba2";
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
        sender_id: 'TextLKDemo',
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
