/**
 * Integration Test Suite for Podman AI Lab HTTP API & State Machine
 * Tests: /api/stats, /api/intents, /script/:key, /dispatch, /circuit-breaker/:key/reset, /events
 */

async function runIntegrationTests() {
  const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
  console.log(`\n=== Running Integration Tests against ${BASE_URL} ===\n`);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}`);
      failed++;
    }
  }

  try {
    // 1. Test /api/stats
    console.log('Test 1: System Telemetry & Resource Caps (/api/stats)');
    const statsRes = await fetch(`${BASE_URL}/api/stats`);
    assert(statsRes.status === 200, 'GET /api/stats returns HTTP 200');
    const stats = await statsRes.json();
    assert(stats.wal_journal_mode === 'WAL', 'SQLite database is running in WAL mode');
    assert(stats.runner_cgroup_caps.memory === '256MB', 'Runner cgroup memory cap is 256MB');
    assert(stats.runner_cgroup_caps.network === 'none', 'Runner cgroup network isolation is none');

    // 2. Test /api/intents
    console.log('\nTest 2: Intent Registry (/api/intents)');
    const intentsRes = await fetch(`${BASE_URL}/api/intents`);
    assert(intentsRes.status === 200, 'GET /api/intents returns HTTP 200');
    const intents = await intentsRes.json();
    assert(Array.isArray(intents) && intents.length > 0, 'Intents list is populated with baseline');
    const hasBaseline = intents.some((i: any) => i.intent_key === 'system_health_diagnostic');
    assert(hasBaseline, "Baseline 'system_health_diagnostic' intent exists");

    // 3. Test /script/:intent_key (Center Pane HTMX & API)
    console.log('\nTest 3: Script Viewer Endpoint (/script/:key & /api/script/:key)');
    const scriptRes = await fetch(`${BASE_URL}/api/script/system_health_diagnostic`);
    assert(scriptRes.status === 200, 'GET /api/script/:key returns HTTP 200');
    const scriptData = await scriptRes.json();
    assert(scriptData.code.includes('def execute(data=None):'), "Script contains mandatory 'def execute(data=None):' entrypoint");
    assert(scriptData.intent.status === 'ACTIVE', 'Baseline intent status is ACTIVE');

    // 4. Test /dispatch - Fast Router Cache Hit
    console.log('\nTest 4: Fast Router Deterministic Cache Hit (/dispatch)');
    const dispatchForm = new URLSearchParams();
    dispatchForm.append('prompt', 'Check system resource health and container metrics');
    const startHit = Date.now();
    const hitRes = await fetch(`${BASE_URL}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: dispatchForm.toString(),
    });
    const hitDuration = Date.now() - startHit;
    assert(hitRes.status === 200, 'POST /dispatch returns HTTP 200');
    const hitHtml = await hitRes.text();
    assert(hitHtml.includes('FAST ROUTER HIT'), 'Fast Router identifies canonical cached intent');
    assert(hitDuration < 500, `Fast router cache resolution is sub-second (${hitDuration}ms)`);

    // 5. Test /dispatch - Evolutionary Synthesis on Cache Miss with custom payload
    console.log('\nTest 5: Evolutionary Fallback on Cache Miss (/dispatch)');
    const synthForm = new URLSearchParams();
    const uniquePrompt = `matrix transpose calculation ${Date.now()}`;
    synthForm.append('prompt', uniquePrompt);
    synthForm.append('custom_data', JSON.stringify({ matrix: [[1, 2], [3, 4]] }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s for LLM synthesis

    const synthRes = await fetch(`${BASE_URL}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: synthForm.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    assert(synthRes.status === 200, 'POST /dispatch with new prompt returns HTTP 200');
    const synthHtml = await synthRes.text();
    assert(synthHtml.includes('EVOLUTIONARY SYNTHESIS'), 'Cache miss triggers evolutionary synthesis');

    // 6. Test /script/:key/run - Ephemeral Runner Execution
    console.log('\nTest 6: Ephemeral Runner Manual Trigger (/script/:key/run)');
    const runRes = await fetch(`${BASE_URL}/script/system_health_diagnostic/run`, {
      method: 'POST',
    });
    assert(runRes.status === 200, 'POST /script/:key/run returns HTTP 200');
    const runHtml = await runRes.text();
    assert(runHtml.includes('Run Completed'), 'Runner executes successfully');

    // 7. Test Circuit Breaker Reset (/circuit-breaker/:key/reset)
    console.log('\nTest 7: Circuit Breaker Reset (/circuit-breaker/:key/reset)');
    const resetRes = await fetch(`${BASE_URL}/circuit-breaker/system_health_diagnostic/reset`, {
      method: 'POST',
    });
    assert(resetRes.status === 200, 'POST /circuit-breaker/:key/reset returns HTTP 200');
    const resetHtml = await resetRes.text();
    assert(resetHtml.includes('Circuit Breaker Reset'), 'Circuit breaker reset acknowledged');

    // 8. Test /v1/models (pi-agent model discovery)
    console.log('\nTest 8: pi-agent Model Discovery (/v1/models)');
    const modelsRes = await fetch(`${BASE_URL}/v1/models`);
    assert(modelsRes.status === 200, 'GET /v1/models returns HTTP 200');
    const modelsData = await modelsRes.json();
    assert(modelsData.object === 'list', "Models response has object: 'list'");
    assert(Array.isArray(modelsData.data) && modelsData.data.length >= 2, 'Models list contains registered models');
    const hasEvolModel = modelsData.data.some((m: any) => m.id === 'ai-lab-evolutionary');
    assert(hasEvolModel, 'ai-lab-evolutionary model is discovered');

    // 9. Test /models.json (pi-agent configuration format)
    console.log('\nTest 9: pi-agent ~/.pi/agent/models.json Provider Spec (/models.json)');
    const configRes = await fetch(`${BASE_URL}/models.json`);
    assert(configRes.status === 200, 'GET /models.json returns HTTP 200');
    const configData = await configRes.json();
    assert(!!configData.providers?.['podman-ai-lab'], "Contains 'podman-ai-lab' provider config");
    assert(configData.providers['podman-ai-lab'].baseUrl.endsWith('/v1'), "Provider baseUrl ends with '/v1'");

    // 10. Test /v1/chat/completions (OpenAI Unary format)
    console.log('\nTest 10: pi-agent Chat Completion Unary (/v1/chat/completions)');
    const chatRes = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'ai-lab-fast-router',
        messages: [{ role: 'user', content: 'Check system resource health and container metrics' }],
        stream: false
      })
    });
    assert(chatRes.status === 200, 'POST /v1/chat/completions returns HTTP 200');
    const chatData = await chatRes.json();
    assert(chatData.object === 'chat.completion', "Response object is 'chat.completion'");
    assert(Array.isArray(chatData.choices) && chatData.choices.length > 0, 'Choices array populated');
    assert(!!chatData.choices[0].message?.content, 'Assistant message content present');

    // 11. Test /v1/chat/completions (OpenAI Streaming format with stream: true)
    console.log('\nTest 11: pi-agent Chat Completion Streaming (/v1/chat/completions?stream=true)');
    const streamRes = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'ai-lab-fast-router',
        messages: [{ role: 'user', content: 'Check system resource health and container metrics' }],
        stream: true
      })
    });
    assert(streamRes.status === 200, 'POST /v1/chat/completions (streaming) returns HTTP 200');
    const streamText = await streamRes.text();
    assert(streamText.includes('chat.completion.chunk'), "SSE stream emits 'chat.completion.chunk'");
    assert(streamText.includes('[DONE]'), "SSE stream terminates with '[DONE]'");

    // Summary
    console.log(`\n==================================================`);
    console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log(`==================================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Integration test runner error:', err);
    process.exit(1);
  }
}

runIntegrationTests();
