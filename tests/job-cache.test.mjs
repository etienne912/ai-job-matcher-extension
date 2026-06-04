import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createJobSignature,
  findCachedAnalysis,
  isMatchingAnalysis
} from '../lib/job-cache.js';

test('job signatures ignore common changing job-board counters', () => {
  const first = createJobSignature('Senior Engineer 42 applicants Posted 2 days ago Requirements Node.js');
  const second = createJobSignature('Senior Engineer 57 applicants Posted 3 days ago Requirements Node.js');

  assert.equal(first, second);
});

test('analysis cache only matches the exact job signature', () => {
  const firstSignature = createJobSignature('Senior Engineer at Example Corp');
  const secondSignature = createJobSignature('Product Manager at Example Corp');
  const analysis = { jobSignature: firstSignature, score: 80 };

  assert.equal(isMatchingAnalysis(analysis, firstSignature), true);
  assert.equal(isMatchingAnalysis(analysis, secondSignature), false);
  assert.equal(isMatchingAnalysis({ score: 80 }, firstSignature), false);
});

test('history cache lookup uses job signature instead of URL', () => {
  const firstSignature = createJobSignature('First role');
  const secondSignature = createJobSignature('Second role');
  const sharedUrl = 'https://example.com/jobs';
  const history = [
    { jobSignature: firstSignature, url: sharedUrl, jobTitle: 'First role' },
    { jobSignature: secondSignature, url: sharedUrl, jobTitle: 'Second role' }
  ];

  assert.equal(findCachedAnalysis(history, secondSignature)?.jobTitle, 'Second role');
});
