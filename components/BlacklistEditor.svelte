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
  <label for="blacklist">One per line. Domains include their subdomains. You can also paste a URL or use /regular expressions/.</label>

  <textarea
    id="blacklist"
    class="field"
    value={blacklist}
    oninput={handleInput}
    placeholder="example.com&#10;subdomain.example.com&#10;/regex-pattern/"
    rows={8}
    spellcheck="false"
    autocomplete="off"
    aria-invalid={errors.length > 0}
    aria-describedby="blacklist-feedback"
  ></textarea>
  <div id="blacklist-feedback" role="status">
    {#each errors as error}<p class="validation-error">{error}</p>{/each}
  </div>

  <dl>
    <dt><code translate="no">example.com</code></dt>
    <dd>The domain and all its subdomains</dd>
    <dt><code translate="no">subdomain.example.com</code></dt>
    <dd>That subdomain and anything under it</dd>
    <dt><code translate="no">/.*\.example\.com/</code></dt>
    <dd>A regular expression</dd>
  </dl>
</div>

<style>
  .blacklist-editor { min-width: 0; }

  label { display: block; margin-bottom: 0.625rem; font-size: 0.8125rem; color: var(--color-text-muted); }

  textarea {
    display: block;
    width: 100%;
    padding: 0.75rem;
    font: 0.8125rem/1.7 var(--font-mono);
    resize: vertical;
  }

  .validation-error { margin: 0.5rem 0 0; color: var(--color-danger-text); font-size: 0.8125rem; }

  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.375rem 1rem;
    margin: 1rem 0 0;
    font-size: 0.8125rem;
    color: var(--color-text-muted);
  }
  dd { margin: 0; }
  code { font: 500 0.75rem var(--font-mono); color: var(--color-text); overflow-wrap: anywhere; }
</style>
