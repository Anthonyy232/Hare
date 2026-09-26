"""Native Firefox extension regressions. See tests/native/README.md."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = "http://127.0.0.1:41739/video.html"
ADDON = "hare@anthonyy232.github.io"
UUID = "38dbb782-5110-4b7c-aa92-632754cf63cf"
BASE = f"moz-extension://{UUID}/"
OUTPUT = Path(os.environ.get("HARE_FIREFOX_RESULTS", ROOT / "test-results/firefox"))


class FirefoxFlows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        OUTPUT.mkdir(parents=True, exist_ok=True)
        cls.server = subprocess.Popen(["node", "tests/e2e/server.mjs"], cwd=ROOT,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.addClassCleanup(cls.server.wait, timeout=10)
        cls.addClassCleanup(cls.server.terminate)
        cls.temp = tempfile.TemporaryDirectory(prefix="hare-firefox-")
        cls.addClassCleanup(cls.temp.cleanup)
        xpi = Path(cls.temp.name) / "hare.xpi"
        build = ROOT / ".output/firefox-mv3"
        with zipfile.ZipFile(xpi, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in build.rglob("*"):
                if path.is_file():
                    archive.write(path, path.relative_to(build))
        options = Options()
        if os.environ.get("FIREFOX_BINARY"):
            options.binary_location = os.environ["FIREFOX_BINARY"]
        options.set_preference("extensions.webextensions.uuids", json.dumps({ADDON: UUID}))
        # Firefox requires system access to navigate to extension pages.
        cls.driver = webdriver.Firefox(options=options, service=Service(service_args=["--allow-system-access"]))
        cls.addClassCleanup(cls.driver.quit)
        cls.driver.set_window_size(1100, 900)
        cls.driver.set_script_timeout(15)
        cls.driver.install_addon(str(xpi), temporary=True)
        cls.driver.set_context("chrome")
        cls.driver.execute_script("gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), "
                                  "{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()})", BASE + "options.html")
        cls.driver.set_context("content")
        WebDriverWait(cls.driver, 15).until(EC.text_to_be_present_in_element((By.TAG_NAME, "body"), "Core Settings"))
        cls.options_handle = cls.driver.current_window_handle
        cls.defaults = cls.driver.execute_async_script("const done=arguments[0];browser.storage.sync.get('hare-settings').then(x=>done(x['hare-settings']))")
        (OUTPUT / "environment.json").write_text(json.dumps(cls.driver.capabilities, indent=2))

    def setUp(self):
        self.d = self.driver
        for handle in self.d.window_handles:
            if handle != self.options_handle:
                self.d.switch_to.window(handle)
                self.d.close()
        self.d.switch_to.window(self.options_handle)
        self.rpc("STOP_SYNC")
        self.promise("browser.storage.sync.set({'hare-settings':arguments[0]})", self.defaults)
        self.d.refresh()
        self.until(lambda: "All changes saved" in self.body())

    def tearDown(self):
        self.d.save_screenshot(str(OUTPUT / (self._testMethodName + ".png")))
        (OUTPUT / (self._testMethodName + ".txt")).write_text(self.body())

    def until(self, condition):
        return WebDriverWait(self.d, 12).until(lambda _: condition())

    def body(self):
        return self.d.find_element(By.TAG_NAME, "body").text

    def promise(self, expression, *args):
        result = self.d.execute_async_script("const done=arguments[arguments.length-1]; Promise.resolve(" + expression + ").then(value=>done({value}),error=>done({error:String(error)}))", *args)
        if "error" in result:
            raise AssertionError(result["error"])
        return result.get("value")

    def rpc(self, kind, payload=None):
        return self.promise("browser.runtime.sendMessage({type:arguments[0],payload:arguments[1]})", kind, payload)

    def css(self, selector):
        return self.d.find_element(By.CSS_SELECTOR, selector)

    def button(self, name):
        return self.d.find_element(By.XPATH, f"//button[normalize-space(.)='{name}' or @aria-label='{name}']")

    def field(self, name):
        return self.css(f'input[aria-label="{name}"]')

    def fill(self, field, value):
        field.send_keys(Keys.CONTROL, "a")
        field.send_keys(Keys.BACKSPACE)
        field.send_keys(str(value))

    def media(self, expression):
        return self.d.execute_script("const v=document.querySelector('video');return " + expression)

    def controller(self, selector):
        return self.css("hare-controller").shadow_root.find_element(By.CSS_SELECTOR, selector)

    def count(self):
        return len(self.d.find_elements(By.CSS_SELECTOR, "hare-controller"))

    def video(self, query=""):
        self.d.switch_to.new_window("tab")
        self.d.get(FIXTURE + query)
        if "empty" not in query and "frame" not in query:
            self.until(lambda: self.count() == 1 and self.media("v.readyState >= 2"))
        return self.d.current_window_handle

    def popup(self, media_handle):
        self.d.switch_to.window(media_handle)
        url = self.d.current_url
        self.d.switch_to.window(self.options_handle)
        previous = set(self.d.window_handles)
        # Mount the popup while its media tab is active, just as a toolbar popup does.
        popup = self.promise("(async()=>{const tabs=await browser.tabs.query({}); const media=tabs.find(t=>t.url===arguments[0]); await browser.tabs.update(media.id,{active:true}); return browser.tabs.create({url:arguments[1],active:false})})()", url, BASE + "popup.html")
        self.until(lambda: self.promise("browser.tabs.get(arguments[0])", popup["id"])["status"] == "complete")
        handle = self.until(lambda: next(iter(set(self.d.window_handles) - previous), None))
        self.d.switch_to.window(handle)
        self.until(lambda: "Connecting to this tab" not in self.body())
        return handle

    def patch(self, **patch):
        current = self.d.current_window_handle
        self.d.switch_to.window(self.options_handle)
        self.promise("(async()=>{const x=await browser.storage.sync.get('hare-settings');await browser.storage.sync.set({'hare-settings':{...x['hare-settings'],...arguments[0]}})})()", patch)
        self.d.switch_to.window(current)

    def test_keyboard_and_editors(self):
        self.video()
        self.css("h1").click()
        self.d.switch_to.active_element.send_keys("d")
        self.until(lambda: abs(self.media("v.playbackRate") - 1.1) < .001)
        self.d.switch_to.active_element.send_keys("s")
        self.until(lambda: self.media("v.playbackRate") == 1)
        self.media("v.currentTime=5")
        self.d.switch_to.active_element.send_keys("z")
        self.until(lambda: self.media("v.currentTime") == 0)
        self.d.switch_to.active_element.send_keys("x")
        self.until(lambda: self.media("v.currentTime") == 10)
        self.css("input").send_keys("dsrxzv")
        self.css("[contenteditable]").send_keys("dsrxzv")
        self.assertEqual(self.media("v.playbackRate"), 1)
        self.css("h1").click()
        self.d.switch_to.active_element.send_keys(Keys.SHIFT, "d", Keys.NULL)
        self.assertEqual(self.media("v.playbackRate"), 1)
        self.d.switch_to.active_element.send_keys("v")
        self.until(lambda: not self.controller(".hare-speed").is_displayed())
        self.d.switch_to.active_element.send_keys("v")
        self.until(lambda: self.controller(".hare-speed").is_displayed())

    def test_popup_speed_and_site_access(self):
        video = self.video("?popup")
        popup = self.popup(video)
        self.fill(self.field("Playback speed"), "1.75")
        self.field("Playback speed").send_keys(Keys.ENTER)
        WebDriverWait(self.d, 12).until(EC.text_to_be_present_in_element((By.CSS_SELECTOR, ".speed-display"), "1.75"))
        self.button("Set speed to 1.5x").click()
        WebDriverWait(self.d, 12).until(EC.text_to_be_present_in_element((By.CSS_SELECTOR, ".speed-display"), "1.50"))
        self.button("Exclude this site").click()
        self.until(lambda: "This site is excluded" in self.body())
        self.d.switch_to.window(video)
        self.until(lambda: self.count() == 0)
        self.d.switch_to.window(popup)
        self.button("Use Hare on this site").click()
        self.until(lambda: "This site is excluded" not in self.body())
        self.d.switch_to.window(video)
        self.until(lambda: self.count() == 1)
        self.assertAlmostEqual(self.media("v.playbackRate"), 1.5)

    def test_settings_save_reset_and_audio(self):
        self.fill(self.field("Reset Speed Target speed"), "1.75")
        self.field("Reset Speed Target speed").send_keys(Keys.TAB)
        self.button("Save Settings").click()
        self.until(lambda: "Settings saved" in self.body())
        self.d.refresh()
        self.until(lambda: self.field("Reset Speed Target speed").get_attribute("value") == "1.75")
        video = self.video("?settings")
        self.css("h1").click()
        self.d.switch_to.active_element.send_keys("r")
        self.until(lambda: self.media("v.playbackRate") == 1.75)
        self.d.execute_script("const a=document.createElement('audio');a.src='/media.wav';a.controls=true;document.body.append(a)")
        self.patch(enableAudio=True)
        self.until(lambda: self.count() == 2)
        self.patch(enabled=False)
        self.until(lambda: self.count() == 0)
        self.patch(enabled=True, enableAudio=False)
        self.until(lambda: self.count() == 1)
        self.d.switch_to.window(self.options_handle)
        self.button("Reset to Defaults").click()
        self.d.switch_to.alert.accept()
        self.until(lambda: self.field("Reset Speed Target speed").get_attribute("value") == "1")
        self.d.switch_to.window(video)
        self.css("h1").click()
        self.d.switch_to.active_element.send_keys("r")
        self.until(lambda: self.media("v.playbackRate") == 1)

    def test_closed_shadow_media(self):
        self.video("?empty")
        self.d.execute_script("""
            const host = document.createElement('div');
            window.closedPlayer = host.attachShadow({mode: 'closed'});
            window.closedPlayer.innerHTML = '<div><video controls src="/media.wav"></video></div>';
            document.body.append(host);
        """)
        self.until(lambda: self.d.execute_script("return !!window.closedPlayer.querySelector('hare-controller')"))
        self.css("h1").click()
        self.d.switch_to.active_element.send_keys("d")
        self.until(lambda: abs(self.d.execute_script("return window.closedPlayer.querySelector('video').playbackRate") - 1.1) < .001)

    def test_iframe_and_parent_exclusion(self):
        self.video("?frame")
        self.d.switch_to.frame(self.css("iframe"))
        self.until(lambda: self.count() == 1)
        self.d.switch_to.default_content()
        self.css("h1").click()
        self.d.switch_to.active_element.send_keys("d")
        self.d.switch_to.frame(self.css("iframe"))
        self.until(lambda: abs(self.media("v.playbackRate") - 1.1) < .001)
        self.d.switch_to.default_content()
        self.patch(blacklist="127.0.0.1")
        self.d.switch_to.frame(self.css("iframe"))
        self.until(lambda: self.count() == 0)
        self.d.switch_to.default_content()
        self.patch(blacklist="")
        self.d.switch_to.frame(self.css("iframe"))
        self.until(lambda: self.count() == 1)
        self.d.switch_to.default_content()

    def test_sync_start_rate_seek_play_pause_nudge_stop(self):
        a = self.video("?sync-a")
        self.media("v.currentTime=10")
        b = self.video("?sync-b")
        self.media("v.currentTime=15")
        popup = self.popup(a)
        self.button("Sync Mode").click()
        self.until(lambda: len(self.d.find_elements(By.CSS_SELECTOR, ".candidate")) == 2)
        for item in self.d.find_elements(By.CSS_SELECTOR, ".candidate"):
            item.click()
        self.button("Start Sync").click()
        self.until(lambda: self.rpc("GET_SYNC_STATUS")["active"])
        Select(self.css("select[aria-label='Nudge step']")).select_by_value("0.5")
        self.until(lambda: self.rpc("GET_SYNC_STATUS")["nudgeStep"] == .5)
        self.button("Shift B later").click()
        self.until(lambda: self.rpc("GET_SYNC_STATUS")["offset"] in (4.5, 5.5, -4.5, -5.5))
        # The UI defines A by click order, so use its recorded tab URLs for directional assertions.
        status = self.rpc("GET_SYNC_STATUS")
        url_a = self.promise("browser.tabs.get(arguments[0]).then(t=>t.url)", status["videoA"]["tabId"])
        primary, follower = (a, b) if url_a.endswith("sync-a") else (b, a)
        self.d.switch_to.window(primary)
        self.css("h1").click()
        self.d.switch_to.active_element.send_keys("d")
        self.d.switch_to.window(follower)
        self.until(lambda: abs(self.media("v.playbackRate") - 1.1) < .001)
        self.d.switch_to.window(primary)
        self.media("v.currentTime=25")
        self.d.switch_to.window(follower)
        self.until(lambda: abs(self.media("v.currentTime") - (25 + status["offset"])) < .1)
        self.d.switch_to.window(primary)
        self.promise("document.querySelector('video').play()")
        self.d.switch_to.window(follower)
        self.until(lambda: not self.media("v.paused"))
        self.d.switch_to.window(primary)
        self.media("v.pause()")
        self.d.switch_to.window(follower)
        self.until(lambda: self.media("v.paused"))
        self.d.switch_to.window(popup)
        self.button("Stop").click()
        self.until(lambda: not self.rpc("GET_SYNC_STATUS")["active"])
        self.d.switch_to.window(primary)
        self.css("h1").click()
        self.d.switch_to.active_element.send_keys("r")
        self.d.switch_to.window(follower)
        self.assertAlmostEqual(self.media("v.playbackRate"), 1.1)

    def test_real_video_source_replacement_and_small_player(self):
        self.patch(controllerButtonSize=24)
        self.video("?visual")
        self.assertEqual(self.media("v.videoWidth"), 160)
        self.d.execute_script("document.querySelector('#player').style.width='320px';document.querySelector('video').width=320")
        speed = self.controller(".hare-speed")
        self.d.execute_script("arguments[0].focus()", speed)
        rect = self.css("video").rect
        for button in self.css("hare-controller").shadow_root.find_elements(By.CSS_SELECTOR, ".hare-btn"):
            self.assertLessEqual(button.rect["x"] + button.rect["width"], rect["x"] + rect["width"] + 1)
        self.controller("[aria-label='Faster']").click()
        self.until(lambda: abs(self.media("v.playbackRate") - 1.1) < .001)
        start = speed.rect
        ActionChains(self.d).click_and_hold(speed).move_by_offset(0, 60).perform()
        self.assertAlmostEqual(speed.rect["y"] - start["y"], 60, delta=1)
        ActionChains(self.d).move_by_offset(350, 0).release().perform()
        self.until(lambda: "dragging" not in self.controller(".hare-controller").get_attribute("class"))
        for index in range(3):
            self.media(f"(v.src='/motion.webm?replace={index}',v.load())")
            self.until(lambda: self.count() == 1 and self.media("v.readyState >= 2"))
        self.css("h1").click()
        self.d.switch_to.active_element.send_keys("r")
        self.until(lambda: self.media("v.playbackRate") == 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
