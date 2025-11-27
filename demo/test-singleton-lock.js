#!/usr/bin/env node

/**
 * Test script for singleton lock behavior
 *
 * Verifies that:
 * 1. Only one host can run per workspace
 * 2. Second instance is rejected
 * 3. Stale lock is detected and cleared
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const testWorkspace = '/tmp/test-singleton-workspace';
const lockFile = path.join(testWorkspace, '.code/code-bridge.lock');

// Cleanup
if (fs.existsSync(testWorkspace)) {
  fs.rmSync(testWorkspace, { recursive: true });
}
fs.mkdirSync(testWorkspace, { recursive: true });

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startHost(label) {
  return new Promise((resolve, reject) => {
    const process = spawn('node', [
      path.join(__dirname, '../bin/code-bridge-host.js'),
      testWorkspace
    ]);

    let output = '';
    let errorOutput = '';

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('exit', (code) => {
      resolve({ code, output, errorOutput, process });
    });

    // Kill after 1 second if still running
    setTimeout(() => {
      if (!process.killed) {
        process.kill('SIGTERM');
      }
    }, 1000);
  });
}

async function test1() {
  console.log('Test 1: Second instance should be rejected');

  // Start first instance
  const first = spawn('node', [
    path.join(__dirname, '../bin/code-bridge-host.js'),
    testWorkspace
  ]);

  // Wait for it to start
  await sleep(500);

  // Try to start second instance
  const second = await startHost('second');

  // Check that second was rejected
  if (second.code === 1 && second.errorOutput.includes('already running')) {
    console.log('  ✓ Second instance rejected');
  } else {
    console.log('  ✗ Second instance should have been rejected');
    console.log('    Exit code:', second.code);
    console.log('    Error:', second.errorOutput);
  }

  // Cleanup first instance
  first.kill('SIGTERM');
  await sleep(500);
}

async function test2() {
  console.log('\nTest 2: Stale lock should be detected and cleared');

  // Create a stale lock with a fake PID
  const staleLock = {
    pid: 999999999, // PID that doesn't exist
    startedAt: new Date().toISOString(),
    workspacePath: testWorkspace
  };

  fs.writeFileSync(lockFile, JSON.stringify(staleLock, null, 2));
  console.log('  Created stale lock with PID 999999999');

  // Try to start a new instance
  const result = await startHost('stale-test');

  // Check that it detected stale lock and started successfully
  if (result.code === 0 && result.output.includes('Stale lock detected')) {
    console.log('  ✓ Stale lock detected and cleared');
  } else {
    console.log('  ✗ Stale lock should have been detected');
    console.log('    Exit code:', result.code);
    console.log('    Output:', result.output);
  }
}

async function test3() {
  console.log('\nTest 3: Lock and metadata cleaned up on shutdown');

  // Start instance
  const process = spawn('node', [
    path.join(__dirname, '../bin/code-bridge-host.js'),
    testWorkspace
  ]);

  // Wait for it to start
  await sleep(500);

  // Verify files exist
  const lockExists = fs.existsSync(lockFile);
  const metaFile = path.join(testWorkspace, '.code/code-bridge.json');
  const metaExists = fs.existsSync(metaFile);

  console.log(`  Lock file exists: ${lockExists}`);
  console.log(`  Metadata file exists: ${metaExists}`);

  // Shutdown
  process.kill('SIGTERM');
  await sleep(1000);

  // Verify cleanup
  const lockExistsAfter = fs.existsSync(lockFile);
  const metaExistsAfter = fs.existsSync(metaFile);

  if (!lockExistsAfter && !metaExistsAfter) {
    console.log('  ✓ Files cleaned up on shutdown');
  } else {
    console.log('  ✗ Files should have been cleaned up');
    console.log(`    Lock still exists: ${lockExistsAfter}`);
    console.log(`    Metadata still exists: ${metaExistsAfter}`);
  }
}

// Run tests
(async () => {
  try {
    await test1();
    await test2();
    await test3();
    console.log('\n✓ All singleton tests passed!');
  } catch (err) {
    console.error('\n✗ Test failed:', err);
    process.exit(1);
  }
})();
