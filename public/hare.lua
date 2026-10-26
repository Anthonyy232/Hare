-- Hare sync for mpv: lets the Hare browser extension keep this player in sync with a browser tab.
-- Install: put this file in mpv's scripts folder
--   Windows: %APPDATA%\mpv\scripts\    macOS and Linux: ~/.config/mpv/scripts/
-- Then open a video in mpv and choose it in Hare's Sync Mode list.

local msg = require 'mp.msg'
local utils = require 'mp.utils'

local PORT = 42730

local has_ffi, ffi = pcall(require, 'ffi')
if not has_ffi then
  msg.error('Hare sync needs an mpv build that uses LuaJIT.')
  return
end
local bit = require 'bit'

-- Minimal non-blocking TCP over the system socket API, since mpv scripts have no networking of their own.
local net = {}
if ffi.os == 'Windows' then
  ffi.cdef [[
    typedef uintptr_t hare_socket;
    int WSAStartup(uint16_t version, void *data);
    int WSAGetLastError(void);
    hare_socket socket(int domain, int type, int protocol);
    int bind(hare_socket s, const void *addr, int len);
    int listen(hare_socket s, int backlog);
    hare_socket accept(hare_socket s, void *addr, void *len);
    int recv(hare_socket s, char *buf, int len, int flags);
    int send(hare_socket s, const char *buf, int len, int flags);
    int closesocket(hare_socket s);
    int ioctlsocket(hare_socket s, long cmd, unsigned long *arg);
  ]]
  local ws = ffi.load('ws2_32')
  local INVALID = ffi.cast('hare_socket', -1)
  local FIONBIO = bit.tobit(0x8004667E)
  ws.WSAStartup(0x0202, ffi.new('char[1024]'))
  net.valid = function(s) return s ~= INVALID end
  net.socket = function() return ws.socket(2, 1, 6) end
  net.bind, net.listen, net.accept, net.close = ws.bind, ws.listen, ws.accept, ws.closesocket
  net.recv = function(s, buf, len) return ws.recv(s, buf, len, 0) end
  net.send = function(s, data, len) return ws.send(s, data, len, 0) end
  net.would_block = function() return ws.WSAGetLastError() == 10035 end
  net.nonblocking = function(s) ws.ioctlsocket(s, FIONBIO, ffi.new('unsigned long[1]', 1)) end
  net.reuse = function() end -- Windows lets SO_REUSEADDR steal a port in use, so leave it off.
else
  ffi.cdef [[
    int socket(int domain, int type, int protocol);
    int setsockopt(int s, int level, int name, const void *value, unsigned int len);
    int bind(int s, const void *addr, unsigned int len);
    int listen(int s, int backlog);
    int accept(int s, void *addr, void *len);
    long recv(int s, char *buf, size_t len, int flags);
    long send(int s, const char *buf, size_t len, int flags);
    int close(int s);
    int fcntl(int s, int cmd, ...);
  ]]
  local C = ffi.C
  local mac = ffi.os == 'OSX'
  local O_NONBLOCK, EAGAIN = mac and 4 or 2048, mac and 35 or 11
  local SOL_SOCKET, SO_REUSEADDR = mac and 0xffff or 1, mac and 4 or 2
  local MSG_NOSIGNAL = mac and 0 or 0x4000
  local one = ffi.new('int[1]', 1)
  net.valid = function(s) return s >= 0 end
  net.socket = function() return C.socket(2, 1, 6) end
  net.bind, net.listen, net.accept, net.close = C.bind, C.listen, C.accept, C.close
  net.recv = function(s, buf, len) return tonumber(C.recv(s, buf, len, 0)) end
  net.send = function(s, data, len) return tonumber(C.send(s, data, len, MSG_NOSIGNAL)) end
  net.would_block = function() return ffi.errno() == EAGAIN end
  net.nonblocking = function(s)
    C.fcntl(s, 4, ffi.new('int', bit.bor(C.fcntl(s, 3), O_NONBLOCK)))
    if mac then C.setsockopt(s, SOL_SOCKET, 0x1022, one, 4) end -- SO_NOSIGPIPE
  end
  net.reuse = function(s) C.setsockopt(s, SOL_SOCKET, SO_REUSEADDR, one, 4) end
end

-- sockaddr_in for 127.0.0.1. macOS starts it with a length byte; the others with a 16-bit family.
local addr = ffi.new('uint8_t[16]')
if ffi.os == 'OSX' then addr[0], addr[1] = 16, 2
elseif ffi.abi('le') then addr[0] = 2
else addr[1] = 2 end
addr[2], addr[3] = bit.rshift(PORT, 8), bit.band(PORT, 0xff)
addr[4], addr[7] = 127, 1

local server = net.socket()
net.reuse(server)
if net.bind(server, addr, 16) ~= 0 or net.listen(server, 8) ~= 0 then
  msg.warn('Hare sync could not listen on port ' .. PORT .. '. Is another mpv window already using it?')
  return
end
net.nonblocking(server)

-- Player state. 'file' changes whenever a new file loads, so Hare can end a sync whose file is gone.
local file, files_loaded = nil, 0
local seq, events = 0, {}
local expected, expected_seek = {}, nil

local function emit(action)
  seq = seq + 1
  events[#events + 1] = {
    seq = seq, action = action,
    position = mp.get_property_number('time-pos', 0), rate = mp.get_property_number('speed', 1),
  }
  if #events > 50 then table.remove(events, 1) end
end

-- Hare's own changes come back through these observers too; skip them so they aren't echoed back.
local function from_hare(name, value)
  local want = expected[name]
  expected[name] = nil
  if type(want) == 'number' then return math.abs(want - value) < 1e-3 end
  return want == value
end

mp.observe_property('pause', 'bool', function(_, paused)
  if paused ~= nil and file and not from_hare('pause', paused) then emit(paused and 'pause' or 'play') end
end)
mp.observe_property('speed', 'number', function(_, speed)
  if speed and file and not from_hare('speed', speed) then emit('ratechange') end
end)
mp.observe_property('paused-for-cache', 'bool', function(_, waiting)
  if file then emit(waiting and 'buffering_start' or 'buffering_end') end
end)
mp.register_event('playback-restart', function()
  local landed = expected_seek and math.abs(mp.get_property_number('time-pos', -1) - expected_seek) < 0.25
  expected_seek = nil
  if file and not landed then emit('seek') end
end)
mp.register_event('file-loaded', function()
  files_loaded = files_loaded + 1
  file = mp.get_property('pid', '0') .. '-' .. files_loaded
  seq = seq + 1
end)
mp.register_event('end-file', function()
  file = nil
  seq = seq + 1
end)

local function state()
  local time = mp.get_property_number('time-pos')
  if not file or not time then return nil end
  return {
    file = file, time = time,
    paused = mp.get_property_bool('pause', false),
    buffering = mp.get_property_bool('paused-for-cache', false),
    speed = mp.get_property_number('speed', 1),
    title = mp.get_property('media-title', ''),
  }
end

local function apply(query)
  local seek = tonumber(query.seek)
  local time = mp.get_property_number('time-pos')
  if seek and time and math.abs(time - seek) > 0.05 then
    expected_seek = seek
    mp.commandv('seek', tostring(seek), 'absolute+exact')
  end
  if query.pause then
    local pause = query.pause == '1'
    if mp.get_property_bool('pause') ~= pause then
      expected.pause = pause
      mp.set_property_bool('pause', pause)
    end
  end
  local speed = tonumber(query.speed)
  if speed and math.abs(mp.get_property_number('speed', 1) - speed) > 1e-3 then
    expected.speed = speed
    mp.set_property_number('speed', speed)
  end
end

local function events_json(after)
  local list = {}
  for _, event in ipairs(events) do
    if event.seq > after then list[#list + 1] = utils.format_json(event) end
  end
  return ('{"file":%s,"seq":%d,"events":[%s]}'):format(utils.format_json(file), seq, table.concat(list, ','))
end

local clients = {}
local buffer = ffi.new('char[4096]')

local function respond(client, status, body)
  local response = ('HTTP/1.1 %s\r\nContent-Type: application/json\r\nContent-Length: %d\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n%s')
    :format(status, #body, body)
  net.send(client.socket, response, #response) -- Small enough to always fit the socket's send buffer.
  net.close(client.socket)
  client.done = true
end

local function handle(client)
  local head = client.request:lower()
  -- Web pages can't send custom headers cross-site, and a page that points its own domain at this
  -- machine still sends its own Host, so together these keep websites out.
  if not head:find('\r\nx%-hare: *1\r\n') or not head:find('\r\nhost: *127%.0%.0%.1:' .. PORT .. '\r\n') then
    return respond(client, '403 Forbidden', '{}')
  end
  local path, query_string = client.request:match('^GET ([^ ?]+)%??([^ ]*) HTTP')
  local query = {}
  for key, value in (query_string or ''):gmatch('([^&=]+)=([^&]*)') do query[key] = value end

  if path == '/events' then
    local after = tonumber(query.after) or -1
    if after == seq then
      client.after, client.deadline = after, mp.get_time() + 20
      return
    end
    return respond(client, '200 OK', events_json((after < 0 or after > seq) and seq or after))
  end
  if path == '/set' and file then apply(query) end
  if path ~= '/state' and path ~= '/set' then return respond(client, '404 Not Found', '{}') end
  local current = state()
  if current then return respond(client, '200 OK', utils.format_json(current)) end
  respond(client, '503 Service Unavailable', '{}') -- No file is playing.
end

mp.add_periodic_timer(0.005, function()
  while true do
    local socket = net.accept(server, nil, nil)
    if not net.valid(socket) then break end
    net.nonblocking(socket)
    clients[#clients + 1] = { socket = socket, request = '', opened = mp.get_time() }
  end
  local now = mp.get_time()
  for _, client in ipairs(clients) do
    if client.after then
      if seq ~= client.after or now > client.deadline then respond(client, '200 OK', events_json(client.after)) end
    else
      local n = net.recv(client.socket, buffer, 4096)
      if n > 0 then
        client.request = client.request .. ffi.string(buffer, n)
        if client.request:find('\r\n\r\n') then handle(client) end
      elseif n == 0 or not net.would_block() or now - client.opened > 5 then
        net.close(client.socket)
        client.done = true
      end
    end
  end
  for i = #clients, 1, -1 do
    if clients[i].done then table.remove(clients, i) end
  end
end)

msg.info('Hare sync is listening on 127.0.0.1:' .. PORT)
