/** VLC reads these options; hare.lua applies them in mpv. Some hosts require the site referrer. */
export function playlist(url: string, title: string, time: number, page: string): string {
  const start = time > 0 ? `#EXTVLCOPT:start-time=${time}\n` : '';
  return `#EXTM3U\n#EXTINF:-1,${title.replace(/\s+/g, ' ')}\n#EXTVLCOPT:http-referrer=${new URL(page).origin}/\n${start}${url}\n`;
}
