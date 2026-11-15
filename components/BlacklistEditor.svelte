<script lang="ts">
  interface Props {
    blacklist: string;
    errors: string[];
    onBlacklistChange: (blacklist: string) => void;
  }

  let { blacklist, errors, onBlacklistChange }: Props = $props();

  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    onBlacklistChange(target.value);
  }
</script>

<div class="blacklist-editor">
  <label for="blacklist">
    <strong>Excluded Sites</strong>
    <span class="sublabel"
      >One per line. Domains include their subdomains. You can also paste a URL or use /regular expressions/.</span
    >
  </label>

  <textarea
    id="blacklist"
    class="blacklist-input"
    value={blacklist}
    oninput={handleInput}
    placeholder="example.com&#10;subdomain.example.com&#10;/regex-pattern/"
    rows={8}
    spellcheck="false"
    aria-invalid={errors.length > 0}
    aria-describedby="blacklist-feedback"
  ></textarea>
  <div id="blacklist-feedback" role="status">
    {#each errors as error}<p class="validation-error">{error}</p>{/each}
  </div>

  <div class="examples">
    <strong>Examples:</strong>
    <ul>
      <li><code>example.com</code> - matches domain and all subdomains</li>
      <li><code>subdomain.example.com</code> - matches that domain and its subdomains</li>
      <li><code>/.*\.example\.com/</code> - regular expression matching</li>
    </ul>
  </div>
</div>

<style>
  .validation-error { color: var(--color-danger-text); font-size: 13px; }
  .blacklist-editor {
    width: 100%;
  }

  label {
    display: block;
    margin-bottom: 12px;
  }

  label strong {
    color: var(--color-text);
    font-weight: 600;
    font-size: 15px;
  }

  .sublabel {
    display: block;
    font-size: 13px;
    color: var(--color-text-muted);
    font-weight: normal;
    margin-top: 6px;
  }

  .blacklist-input {
    width: 100%;
    box-sizing: border-box;
    padding: 14px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-field);
    color: var(--color-text);
    font-family: ui-monospace, "SF Mono", Monaco, "Cascadia Code", monospace;
    font-size: 13px;
    line-height: 1.7;
    resize: vertical;
    transition: border-color 0.15s ease;
  }

  .blacklist-input::placeholder {
    color: #666;
    opacity: 1;
  }

  .blacklist-input:focus {
    border-color: var(--color-accent-line);
  }

  .examples {
    margin-top: 16px;
    padding: 16px;
    background: var(--color-field);
    border-radius: var(--radius);
    font-size: 13px;
    line-height: 1.6;
  }

  .examples strong {
    display: block;
    margin-bottom: 12px;
    color: var(--color-text);
    font-weight: 600;
    font-size: 14px;
  }

  .examples ul {
    margin: 0;
    padding-left: 24px;
    color: var(--color-text-muted);
  }

  .examples li {
    margin-bottom: 8px;
  }

  .examples code {
    background: var(--color-accent-soft);
    color: var(--color-focus);
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-family: ui-monospace, "SF Mono", Monaco, "Cascadia Code", monospace;
    font-weight: 600;
  }
</style>
