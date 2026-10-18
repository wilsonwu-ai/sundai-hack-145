# Sundai Hack 145 opening talks: transcript digest

Sources: Whisper transcript (memo.txt, 1,570 lines) and slide text (deck.txt, 47 slides). Event as stated by the requester: MIT CSAIL, 18 Oct 2026.

## Read this first: limits of the transcript

- There are no timestamps. Positions below are rough percentages, measured by line number out of 1,570 lines.
- The usable speech ends near 46% of the file (about line 725). From there on it is Whisper loops ("I think we're working here", "I'm going to go ahead and do that"). Nothing about AutoLab, scores or credits survives in the transcript. That material comes only from the slides.
- The file opens mid-talk with the tail of a different talk, a weekly AI news segment (Meta models and newsletter plugs). That is not part of the hack briefing. Its newsletter and Discord plugs are left out.
- Lines 511-529 are a garbled loop in the middle of a Q&A about wires and crosstalk. Treat that exchange as unclear.
- Neither "Mateusz" nor "Artem" is spoken anywhere in the transcript. See the speaker notes.

## 1. Speakers

| Who | What the transcript says | Confidence |
|---|---|---|
| News presenter (name not given) | Opens the file (0-6%). Talks about Meta's new models, the training-data market, an open-source Meta model with a restrictive license. Plugs a newsletter, an "AI Tools Club" on Tuesdays 5pm, and a Discord. The YouTube channel is heard as "VectorLab" (?). Slide 1 also lists AI Tools Club at 5:00 pm Tue. | Name unknown. Not part of the hack briefing. |
| Main hardware speaker (name not given) | Says he is finishing a PhD on simulation methods for the semiconductor stack. Says he fabricates transistors and nano devices at MIT, working with his advisor. His advisor is heard as "Thomas Paul after school" (?), unclear. He introduces Track 1 (6-18%), then presents all of Track 2 (18-35%). He says he builds a chip meant to sit with a GPU group to cut energy use. | Role clear. Name not stated. He may be the "Mateusz" the requester expects, because the repos on slide 37 sit under the account Czaja107 (?). The transcript does not confirm this. |
| Second Track 1 speaker | Introduced by the main speaker as "Andre" (?) ("Andre is going to explain the details"). Explains the data-center workloads, user cases and constraints (about 11-18%). | "Andre" is a Whisper guess. Could be Artem or someone else. Unclear. |
| Artem (Sundai / AutoLab) | Not heard in the surviving transcript. The slides give a handle, @arteml0178, for extra credits (slide 41). The AutoLab slides (38-41) are presumably his section. | Unconfirmed from audio. |
| Audience members | One asks how HBM differs from the unified memory in Apple laptops. One asks whether a gigawatt data center could be made tiny. One asks whether wires could be split (a name like "Fabio" (?) is heard). One asks the name of the speaker (about 9%). | Unnamed. |

## 2. Talk summary (pyramid)

Main message: the hack asks teams to design for the real limits of AI compute (power, heat, memory), and to use agents and Claude to explore designs quickly. There are 2 topics, 4 points each.

### Topic A: Track 1, "Build the AI data center of 2035" [approx. 6-18% and Q&A 42-46%]

1. Why 2035. The main speaker says data centers up to about 2030 are already planned and signed, so new ideas only matter after that. [about 8%]
2. Scale. One gigawatt is roughly the electricity for a city of one million people, he says. He shows a map of US data centers, planned and operating (slide 6 credits Cleanview). He gives operating capacity as about 60,000 MW and says the planned figure is several times that. The "60 megawatts" he says right after is a slip. [about 9-10%]
3. The task. Put the data center anywhere: underwater, Antarctica, Mars, Cambridge. The second speaker says it is less technical. Start by estimating the numbers (cost, energy, tokens, who is served), then add constraints such as memory, tokens per second and time to first token. Use AI to learn the topic fast. The evening deliverable is a digital plan or calculations. [about 11-18%]
4. Q&A answer. The tiny data center idea hits the grid limit. Chips tuned for one model (he names Taalas (?)) help. Otherwise you need local power, such as a nuclear plant next to the site (he names Oklo (?)). [about 42-46%]

Slide facts for Track 1 (deck vendor figures, not spoken): $30B five-year budget, 500 MW grid power on Earth, $200/kg to orbit, 3 user cases (4B prompters, 50M agent developers, 400M knowledge workers), 6 Earth sites plus orbit, Moon and Mars. Slide 8 cites Jensen Huang (2025) for $50-60B per gigawatt of data center. Slides 19-23 show a second framing, "minimize joules per task", marked PLACEHOLDER in places. It is unclear which framing is final.

### Topic B: Track 2, "Design the coolest chiplet layout" [approx. 18-35%]

1. Background. The speaker walks through the AMD MI300A stack: motherboard, interposer (the silicon base that carries the chips), GPU dies, and HBM (high bandwidth memory, stacked DRAM, about 12 layers). [about 18-25%]
2. Why heat is the problem. GPUs hit a thermal ceiling, and memory can overheat too. A cooler design lets you raise clock speed or load. Memory-heavy and compute-heavy workloads produce different heat maps. [about 25-28%]
3. The challenge. A 52 x 42 mm interposer, 4 GPU dies and 4 HBM dies, 5 power workload patterns. Place the chips and the wires. Scored on the lowest maximum GPU temperature across all workloads, then the HBM temperature. [about 28-31%]
4. The constraints. A Manhattan distance limit between chips, a minimum wire width for each bandwidth, and verification that fails if either is missed. Slides add wire power (0.20 pJ per bit for the two endpoints, plus 0.08 pJ per bit per mm) and a cap on length x bandwidth of 13,500 mm x GB/s. [about 31-35% for the spoken part; the numbers are from slides 28-33]

## 3. Detailed extracts

### Track 2 (chiplets, simulation, repos)

- Based on the AMD MI300 stack. Interposer 52 x 42 mm, four GPU dies, four HBM dies (spoken, about 28%). Slide 28 gives die sizes: GPU 11.5 x 10.5 mm, HBM 10.5 x 10.2 mm.
- Five workload patterns, some memory-heavy, some compute-heavy. The power patterns and constraints come in one file on GitHub, to be shared at the end. [about 30%]
- Goal: place the GPUs and HBM and simulate the thermal behaviour to minimize the max temperature of the GPUs and of the HBM across all workloads. How to solve it is up to the team. [about 30%]
- The organisers will run an agentic harness in the background: propose a layout, run the simulation, read the temperature, feed it back, loop until a best design appears. [about 31%]
- He encourages teams to run their own simulations, with the supplied code or a simulator they write. He says building thermal simulators with Claude is easy and that he has built many for research (transcribed "cloud"). [about 31%]
- Surrogate model: a team can generate a dataset and train a small neural network to stand in for the simulator, so the search runs faster. [about 31%]
- Communication example: 600 GB/s between a GPU and its HBM needs about 4 mm of wire at the chip edge. Slide 31 writes it as 600Gb/s. The unit is inconsistent between speech and slide. Unclear which is right.
- Not said in the transcript: any scoreboard format, any speed-versus-accuracy tradeoff, any explicit "HotSpot" name. Slides 35-36 show an example (max GPU 104.1 C, max HBM 96.3 C) and a simulator with a GUI. The word "HotSpot" does not appear in either file. The speed versus accuracy idea is only implied by the surrogate-model suggestion.
- Repos (slide 37): github.com/Czaja107/chiplet-thermal-simulator (patterns plus simulator) and github.com/Czaja107/chiplet-thermal-gui (adds a GUI).
- Q&A on HBM vs unified memory (about 20%): HBM is stacked DRAM chips, other companies also stack chiplets, and unified memory can also mean on-chip SRAM. He gives SRAM as six transistors per cell, fast but costly in area. DRAM is one transistor plus one capacitor, denser but slower. He gives the read times as microseconds for DRAM and picoseconds for SRAM, which is likely a transcription or speaking slip. He names Cerebras as all-SRAM and says DRAM is made mainly by Micron, SK Hynix and Samsung.

### AutoLab (slides only, no audio survived)

- Slide 38: go to app.autolab.ai, log in with GitHub, click the Gemma 4 card. Title: how to get GPU and LLM credits from AutoLab.
- Slide 39: select the Gemma 4 hill. A hill is data plus an eval.py that Claude Code or Codex can optimize against ("climb"). "Download" means your agent works locally. "Start a climb" runs on AutoLab compute with AutoLab's agent plus yours.
- Slide 40: ways to a better score: drive the agent with your suggestions, connect your own autoresearch harness, or create a new hill. A good hill is fast to evaluate, accurate, open to agent iteration, and publishable. It mentions a proxy hill for a real Kaggle challenge.
- Slide 41: join the AutoLab Discord for support; save the slides; extra credits via @arteml0178; guide at www.sundai.club/guide.
- The track 2 speaker says in the transcript only that the organisers will run an agent loop (see above). He does not say the word AutoLab in the surviving text.
- Scores: no score such as 0.96 appears in the transcript or the deck. No scoreboard rules, submission steps for Claude, or credit amounts are stated. Unclear.

### Using Claude / AI to build things

- Thermal simulators are easy to build with Claude (speaker, Track 2, about 31%).
- Track 1: use AI as much as possible to learn data-center dynamics and speed up the design before the evening demo (second speaker, about 17%).
- Closing Q&A: the main speaker hopes AI can act as an expert across the whole stack (transistor fabrication, circuits, GPU kernels), find global optimums, and fill gaps that separate specialists miss. [about 43%]
- Another answer in the same Q&A (the speaker is unclear) names two big technical trends: cooling layers built inside chips and 3D transistors. [about 45%]
- Event rules (slides 42-44, not spoken): groups publish open source, individuals may stay closed, the theme is a suggestion, demos at 8 pm, no slides, votes decide presentation time.

## 4. Quotes for the explainer page

Rule check: the brief here allows one direct quote of 15 words or fewer, so only quote 1 is verbatim. The other four are close paraphrases, not quotations. Use them without quotation marks, or ask the speaker if you want exact wording.

1. Verbatim: "it's very easy to build thermal simulators with cloud today" (main hardware speaker, about 31% of the file; the audio word is almost certainly "Claude", so correct it in brackets or paraphrase). Source line 472.
2. Paraphrase: Pushing a GPU harder always costs temperature, so a cooler layout buys more performance. (Main hardware speaker, about 26%.)
3. Paraphrase: Chip design, fabrication and GPU software are separate worlds today, and he hopes AI can optimize across all of them. (Main hardware speaker, about 43%.)
4. Paraphrase: Today's grid capacity, not floor space, is the bigger limit on building huge data centers. (Main hardware speaker, about 42%.)
5. Paraphrase: You will design the data center of the future, and you may put it anywhere, even Mars or under the ocean. (Main hardware speaker, about 10%.)

## Caveats

- Names, the advisor's name, and company names (Taalas, Oklo) are Whisper spellings. Check against the slides or the speakers before publishing.
- Numbers above come from the speakers (marked as spoken) or from the slides (the organisers' own figures). Some spoken numbers look like slips and are flagged.
