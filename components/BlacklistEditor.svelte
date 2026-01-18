<script lang="ts">
  interface Props {
    blacklist: string;
    onBlacklistChange: (blacklist: string) => void;
  }

  let { blacklist, onBlacklistChange }: Props = $props();

  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    onBlacklistChange(target.value);
  }
</script>

<div class="blacklist-editor">
  <label for="blacklist">
    <strong>Excluded Sites</strong>
    <span class="sublabel"
      >One per line. Supports domains and regex patterns.</span
    >
  </label>

  <textarea
    id="blacklist"
    class="blacklist-input"
    value={blacklist}
    oninput={handleInput}
    placeholder="example.com&#10;subdomain.example.com&#10;/regex-pattern/"
    rows={8}
  ></textarea>

  <div class="examples">
    <strong>Examples:</strong>
    <ul>
      <li><code>example.com</code> - matches domain and all subdomains</li>
      <li><code>subdomain.example.com</code> - matches only that subdomain</li>
      <li><code>/.*\.example\.com/</code> - regular expression matching</li>
    </ul>
  </div>
</div>

<style>
  .blacklist-editor {
    width: 100%;
  }

  label {
    display: block;
    margin-bottom: 12px;
  }

  label strong {
    color: #f0f0f0;
    font-weight: 600;
    font-size: 15px;
  }

  .sublabel {
    display: block;
    font-size: 13px;
    color: #999;
    font-weight: normal;
    margin-top: 6px;
  }

  .blacklist-input {
    width: 100%;
    padding: 14px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: rgba(40, 40, 40, 0.6);
    color: #f0f0f0;
    font-family: ui-monospace, "SF Mono", Monaco, "Cascadia Code", monospace;
    font-size: 13px;
    line-height: 1.7;
    resize: vertical;
    transition: all 0.15s ease;
  }

  .blacklist-input::placeholder {
    color: #666;
    opacity: 1;
  }

  .blacklist-input:focus {
    outline: none;
    border-color: rgba(59, 130, 246, 0.6);
    background: rgba(40, 40, 40, 0.8);
  }

  .examples {
    margin-top: 16px;
    padding: 16px;
    background: rgba(255, 255, 255, 0.03);
    border-left: 3px solid rgba(59, 130, 246, 0.5);
    border-radius: 4px;
    font-size: 13px;
    line-height: 1.6;
  }

  .examples strong {
    display: block;
    margin-bottom: 12px;
    color: #f0f0f0;
    font-weight: 600;
    font-size: 14px;
  }

  .examples ul {
    margin: 0;
    padding-left: 24px;
    color: #999;
  }

  .examples li {
    margin-bottom: 8px;
  }

  .examples code {
    background: rgba(40, 40, 40, 0.8);
    color: #93c5fd;
    padding: 3px 8px;
    border-radius: 3px;
    font-size: 12px;
    font-family: ui-monospace, "SF Mono", Monaco, "Cascadia Code", monospace;
    font-weight: 600;
  }
</style>
