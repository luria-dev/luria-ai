const fetch = require('node-fetch');

async function testGPT5() {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 10
      })
    });
    
    const data = await response.json();
    if (data.error) {
      console.log('Error:', data.error.message);
    } else {
      console.log('Success! GPT-5.4 is available');
      console.log('Response:', data.choices[0].message.content);
    }
  } catch (error) {
    console.log('Request failed:', error.message);
  }
}

testGPT5();
