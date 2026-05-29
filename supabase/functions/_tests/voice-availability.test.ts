/**
 * Voice Availability Endpoint Tests
 * 
 * Run these tests manually using:
 * deno run --allow-net --allow-env supabase/functions/_tests/voice-availability.test.ts
 * 
 * Or use curl commands provided at the bottom.
 */

// Configuration - update these for your environment
const EDGE_FUNCTION_URL = 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-availability';
const VOICE_AGENT_SECRET = Deno.env.get('VOICE_AGENT_WEBHOOK_SECRET') || 'YOUR_SECRET_HERE';

interface TestResult {
  name: string;
  passed: boolean;
  response?: unknown;
  error?: string;
}

const results: TestResult[] = [];

/**
 * Test 1: Valid request with future date
 */
async function testFutureDate(): Promise<TestResult> {
  const testName = 'Test 1: Future date availability';
  
  try {
    // Get a date 7 days from now
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dateStr = futureDate.toISOString().split('T')[0];
    
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VOICE_AGENT_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: dateStr,
        booking_type: 'hourly',
      }),
    });
    
    const data = await response.json();
    
    const passed = response.ok && 
                   data.ok === true && 
                   typeof data.available === 'boolean' &&
                   Array.isArray(data.next_slots);
    
    return {
      name: testName,
      passed,
      response: data,
      error: passed ? undefined : 'Response did not match expected structure',
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Test 2: Valid request with specific start_time
 */
async function testSpecificTime(): Promise<TestResult> {
  const testName = 'Test 2: Specific start_time';
  
  try {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const dateStr = futureDate.toISOString().split('T')[0];
    
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VOICE_AGENT_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: dateStr,
        start_time: '14:00',
        duration_hours: 4,
        booking_type: 'hourly',
      }),
    });
    
    const data = await response.json();
    
    const passed = response.ok && 
                   data.ok === true && 
                   typeof data.available === 'boolean' &&
                   data.checked_window &&
                   data.checked_window.tz === 'America/New_York';
    
    return {
      name: testName,
      passed,
      response: data,
      error: passed ? undefined : 'Response did not match expected structure',
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Test 3: Invalid auth should return 401
 */
async function testInvalidAuth(): Promise<TestResult> {
  const testName = 'Test 3: Invalid auth returns 401';
  
  try {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer invalid_token_12345',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: '2025-02-15',
      }),
    });
    
    const passed = response.status === 401;
    
    return {
      name: testName,
      passed,
      response: { status: response.status },
      error: passed ? undefined : `Expected 401, got ${response.status}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Test 4: Missing auth header
 */
async function testMissingAuth(): Promise<TestResult> {
  const testName = 'Test 4: Missing auth returns 401';
  
  try {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: '2025-02-15',
      }),
    });
    
    const passed = response.status === 401;
    
    return {
      name: testName,
      passed,
      response: { status: response.status },
      error: passed ? undefined : `Expected 401, got ${response.status}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Test 5: Daily booking type
 */
async function testDailyBooking(): Promise<TestResult> {
  const testName = 'Test 5: Daily booking type';
  
  try {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 14);
    const dateStr = futureDate.toISOString().split('T')[0];
    
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VOICE_AGENT_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: dateStr,
        booking_type: 'daily',
      }),
    });
    
    const data = await response.json();
    
    const passed = response.ok && 
                   data.ok === true && 
                   typeof data.available === 'boolean' &&
                   typeof data.notes_for_agent === 'string';
    
    return {
      name: testName,
      passed,
      response: data,
      error: passed ? undefined : 'Response did not match expected structure',
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Run all tests and print report
 */
async function runTests() {
  console.log('\n========================================');
  console.log('  Voice Availability Endpoint Tests');
  console.log('========================================\n');
  console.log(`Endpoint: ${EDGE_FUNCTION_URL}\n`);
  
  // Run all tests
  results.push(await testFutureDate());
  results.push(await testSpecificTime());
  results.push(await testInvalidAuth());
  results.push(await testMissingAuth());
  results.push(await testDailyBooking());
  
  // Print results
  console.log('\n--- TEST RESULTS ---\n');
  
  let passCount = 0;
  let failCount = 0;
  
  for (const result of results) {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${result.name}`);
    
    if (result.passed) {
      passCount++;
      if (result.response) {
        console.log(`   Response preview: ${JSON.stringify(result.response).slice(0, 200)}...`);
      }
    } else {
      failCount++;
      console.log(`   Error: ${result.error}`);
      if (result.response) {
        console.log(`   Response: ${JSON.stringify(result.response)}`);
      }
    }
    console.log('');
  }
  
  // Summary
  console.log('\n--- SUMMARY ---');
  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Result: ${failCount === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('\n');
  
  // Curl examples
  console.log('--- MANUAL CURL EXAMPLES ---\n');
  console.log(`# Test valid request:
curl -X POST "${EDGE_FUNCTION_URL}" \\
  -H "Authorization: Bearer YOUR_VOICE_AGENT_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"date":"2025-02-15","start_time":"14:00","duration_hours":4}'

# Test invalid auth (should return 401):
curl -X POST "${EDGE_FUNCTION_URL}" \\
  -H "Authorization: Bearer invalid_token" \\
  -H "Content-Type: application/json" \\
  -d '{"date":"2025-02-15"}'
`);
}

// Run tests
runTests();
