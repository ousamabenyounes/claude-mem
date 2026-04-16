import { describe, expect, it } from 'bun:test';

import {
  buildObservationPrompt,
  buildSystemPrompt,
  buildInitPrompt,
  buildInitUserMessage,
  buildContinuationPrompt,
  buildContinuationUserMessage,
} from '../../src/sdk/prompts.js';
import type { ModeConfig } from '../../src/services/domain/types.js';

/**
 * Minimal ModeConfig stub with all prompt fields populated for testing.
 */
function makeModeStub(): ModeConfig {
  return {
    name: 'test',
    description: 'test mode',
    version: '1.0.0',
    observation_types: [
      { id: 'discovery', label: 'Discovery', description: 'A discovery', emoji: '1', work_emoji: '2' },
      { id: 'decision', label: 'Decision', description: 'A decision', emoji: '3', work_emoji: '4' },
    ],
    observation_concepts: [],
    prompts: {
      system_identity: 'You are a memory observer agent.',
      spatial_awareness: 'Pay attention to file paths.',
      observer_role: 'Observe tool usage silently.',
      recording_focus: 'Record durable discoveries.',
      skip_guidance: 'Skip trivial operations.',
      type_guidance: 'Use discovery or decision types.',
      concept_guidance: 'Tag with relevant concepts.',
      field_guidance: 'Include concrete facts.',
      output_format_header: 'Respond in XML format:',
      format_examples: '',
      footer: 'Good luck observing.',
      xml_title_placeholder: '[title]',
      xml_subtitle_placeholder: '[subtitle]',
      xml_fact_placeholder: '[fact]',
      xml_narrative_placeholder: '[narrative]',
      xml_concept_placeholder: '[concept]',
      xml_file_placeholder: '[file]',
      xml_summary_request_placeholder: '[request]',
      xml_summary_investigated_placeholder: '[investigated]',
      xml_summary_learned_placeholder: '[learned]',
      xml_summary_completed_placeholder: '[completed]',
      xml_summary_next_steps_placeholder: '[next_steps]',
      xml_summary_notes_placeholder: '[notes]',
      header_memory_start: 'MEMORY PROCESSING START\n=======================',
      header_memory_continued: 'MEMORY PROCESSING CONTINUED\n===========================',
      header_summary_checkpoint: 'PROGRESS SUMMARY CHECKPOINT',
      continuation_greeting: 'Hello memory agent, continuing observation.',
      continuation_instruction: 'Continue generating observations.',
      summary_instruction: 'Write a summary.',
      summary_context_label: "Claude's Full Response:",
      summary_format_instruction: 'Use XML format:',
      summary_footer: 'End.',
    },
  };
}

describe('buildObservationPrompt', () => {
  it('instructs the observer to avoid prose skip responses', () => {
    const prompt = buildObservationPrompt({
      id: 1,
      tool_name: 'exec_command',
      tool_input: JSON.stringify({ cmd: 'pwd' }),
      tool_output: JSON.stringify({ output: '/repo' }),
      created_at_epoch: Date.now(),
      cwd: '/repo',
    });

    expect(prompt).toContain('Return either one or more <observation>...</observation> blocks, or an empty response');
    expect(prompt).toContain('Concrete debugging findings from logs, queue state, database rows, session routing, or code-path inspection');
    expect(prompt).toContain('Never reply with prose such as "Skipping", "No substantive tool executions"');
  });
});

describe('buildSystemPrompt (Issue #1891)', () => {
  const mode = makeModeStub();
  const systemPrompt = buildSystemPrompt(mode);

  it('contains the static mode identity', () => {
    expect(systemPrompt).toContain('You are a memory observer agent.');
  });

  it('contains the observer role', () => {
    expect(systemPrompt).toContain('Observe tool usage silently.');
  });

  it('contains spatial awareness', () => {
    expect(systemPrompt).toContain('Pay attention to file paths.');
  });

  it('contains recording focus', () => {
    expect(systemPrompt).toContain('Record durable discoveries.');
  });

  it('contains skip guidance', () => {
    expect(systemPrompt).toContain('Skip trivial operations.');
  });

  it('contains the XML observation template', () => {
    expect(systemPrompt).toContain('<observation>');
    expect(systemPrompt).toContain('discovery | decision');
  });

  it('contains the footer', () => {
    expect(systemPrompt).toContain('Good luck observing.');
  });

  it('does NOT contain session-start headers (those are dynamic)', () => {
    expect(systemPrompt).not.toContain('MEMORY PROCESSING START');
    expect(systemPrompt).not.toContain('MEMORY PROCESSING CONTINUED');
  });

  it('does NOT contain user request XML (that is dynamic)', () => {
    expect(systemPrompt).not.toContain('<user_request>');
  });
});

describe('buildInitUserMessage (Issue #1891)', () => {
  const mode = makeModeStub();
  const userMessage = buildInitUserMessage('Fix the login bug', mode);

  it('contains the user request', () => {
    expect(userMessage).toContain('Fix the login bug');
    expect(userMessage).toContain('<user_request>');
  });

  it('contains the session-start header', () => {
    expect(userMessage).toContain('MEMORY PROCESSING START');
  });

  it('does NOT contain static mode instructions', () => {
    expect(userMessage).not.toContain('You are a memory observer agent.');
    expect(userMessage).not.toContain('Observe tool usage silently.');
    expect(userMessage).not.toContain('Pay attention to file paths.');
    expect(userMessage).not.toContain('Record durable discoveries.');
    expect(userMessage).not.toContain('Skip trivial operations.');
    expect(userMessage).not.toContain('<observation>');
    expect(userMessage).not.toContain('Good luck observing.');
  });
});

describe('buildContinuationUserMessage (Issue #1891)', () => {
  const mode = makeModeStub();
  const userMessage = buildContinuationUserMessage('Continue working', mode);

  it('contains the user request', () => {
    expect(userMessage).toContain('Continue working');
    expect(userMessage).toContain('<user_request>');
  });

  it('contains continuation greeting and instruction', () => {
    expect(userMessage).toContain('Hello memory agent, continuing observation.');
    expect(userMessage).toContain('Continue generating observations.');
  });

  it('contains the continuation header', () => {
    expect(userMessage).toContain('MEMORY PROCESSING CONTINUED');
  });

  it('does NOT contain static mode instructions', () => {
    expect(userMessage).not.toContain('You are a memory observer agent.');
    expect(userMessage).not.toContain('Observe tool usage silently.');
    expect(userMessage).not.toContain('<observation>');
    expect(userMessage).not.toContain('Good luck observing.');
  });
});

describe('system + user message completeness (Issue #1891)', () => {
  const mode = makeModeStub();

  it('system prompt + init user message covers all content from legacy buildInitPrompt', () => {
    const systemPrompt = buildSystemPrompt(mode);
    const userMessage = buildInitUserMessage('Fix bug', mode);
    const combined = systemPrompt + '\n' + userMessage;
    const legacy = buildInitPrompt('/project', 'session-123', 'Fix bug', mode);

    // All key static instructions must appear in the combined output
    expect(combined).toContain('You are a memory observer agent.');
    expect(combined).toContain('Observe tool usage silently.');
    expect(combined).toContain('<observation>');
    expect(combined).toContain('Fix bug');
    expect(combined).toContain('MEMORY PROCESSING START');

    // All key content from legacy must appear in either system or user message
    for (const fragment of [
      'You are a memory observer agent.',
      'Observe tool usage silently.',
      'Pay attention to file paths.',
      'Record durable discoveries.',
      'Skip trivial operations.',
      'Good luck observing.',
      'MEMORY PROCESSING START',
    ]) {
      expect(combined).toContain(fragment);
      expect(legacy).toContain(fragment);
    }
  });

  it('system prompt + continuation user message covers all content from legacy buildContinuationPrompt', () => {
    const systemPrompt = buildSystemPrompt(mode);
    const userMessage = buildContinuationUserMessage('Continue', mode);
    const combined = systemPrompt + '\n' + userMessage;
    const legacy = buildContinuationPrompt('Continue', 2, 'session-123', mode);

    for (const fragment of [
      'You are a memory observer agent.',
      'Observe tool usage silently.',
      'Hello memory agent, continuing observation.',
      'Continue generating observations.',
      'MEMORY PROCESSING CONTINUED',
    ]) {
      expect(combined).toContain(fragment);
      expect(legacy).toContain(fragment);
    }
  });
});
