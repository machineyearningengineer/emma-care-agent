"""Narration for the film: script.json -> audio/n{i}.mp3 and timing.json (sentence and word start times).

ELEVENLABS_API_KEY=… python narrate.py [section numbers]   (no numbers: all sections)
Then rebuild timeline.js from timing.json and re-render with render.mjs.
"""

import base64
import json
import os
import re
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__)) + "/"
VOICE = "pFQStpMdprGFILRDrWR2"
SPOKEN_ID = "I D"  # written "ID" in captions; spelled out so the voice says "eye dee"


def tts(text: str) -> dict:
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128",
        data=json.dumps(
            {
                "text": text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {"stability": 0.55, "similarity_boost": 0.8},
            }
        ).encode(),
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def main() -> None:
    with open(HERE + "script.json") as f:
        script = json.load(f)
    only = {int(x) for x in sys.argv[1:]}
    path = HERE + "timing.json"
    out = [None] * len(script)
    if os.path.exists(path):
        with open(path) as f:
            out = (json.load(f) + out)[: len(script)]
    os.makedirs(HERE + "audio", exist_ok=True)
    for i, text in enumerate(script):
        if only and i not in only:
            continue
        d = tts(text)
        with open(HERE + f"audio/n{i}.mp3", "wb") as f:
            f.write(base64.b64decode(d["audio_base64"]))
        cs = d["alignment"]["character_start_times_seconds"]
        spoken = re.split(r"(?<=[.?!:])\s+", text)
        pos, starts = 0, []
        for s in spoken:
            idx = text.index(s, pos)
            starts.append(round(cs[idx], 2))
            pos = idx + len(s)
        words = [[m.group(0), round(cs[m.start()], 2)] for m in re.finditer(r"\S+", text)]
        probe = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"]
        dur = float(subprocess.check_output([*probe, HERE + f"audio/n{i}.mp3"]))
        sentences = [s.replace(SPOKEN_ID, "ID") for s in spoken]
        out[i] = {"sentences": sentences, "starts": starts, "words": words, "dur": round(dur, 2)}
        print(i, round(dur, 1), starts, flush=True)
    with open(path, "w") as f:
        json.dump(out, f)


if __name__ == "__main__":
    main()
