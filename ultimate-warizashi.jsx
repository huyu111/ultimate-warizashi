
const MAX = 5; // ロールオーバーする境界(5本で0に戻る)

const SKILLS = {
  invincible: { id: "invincible", name: "無敵化", desc: "次の相手ターン中、攻撃を無効化", cd: 4 },
  double: { id: "double", name: "攻撃力2倍", desc: "自分の指を2倍にして1回攻撃", cd: 3 },
  aoe: { id: "aoe", name: "全体攻撃", desc: "自分の1つの手で相手の両手を攻撃", cd: 5 },
  twice: { id: "twice", name: "二回攻撃", desc: "発動後、もう一度自分の番が続けて来る(クールタイムは仮:5)", cd: 5 },
};
const SKILL_LIST = Object.values(SKILLS);

function isDead(v) {
  return v === 0;
}
function bothDead(hands) {
  return isDead(hands[0]) && isDead(hands[1]);
}
function randomSkillId() {
  const keys = Object.keys(SKILLS);
  return keys[Math.floor(Math.random() * keys.length)];
}

function Fingers({ count }) {
  // 4本分のスロットを横に並べ、countの数だけ「立てた指」として塗りつぶす
  const slots = [0, 1, 2, 3];
  return (
    <svg viewBox="0 0 100 60" className="w-14 h-10">
      {slots.map((i) => {
        const active = i < count;
        const x = 8 + i * 22;
        const h = active ? 46 : 32;
        const y = 56 - h;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width="14"
              height={h}
              rx="7"
              fill={active ? "currentColor" : "none"}
              stroke={active ? "none" : "#D1D5DB"}
              strokeWidth="2.5"
            />
            {active && <circle cx={x + 7} cy={y + 7} r="5" fill="currentColor" opacity="0.6" />}
          </g>
        );
      })}
    </svg>
  );
}

function Hand({ count, selected, disabled, onClick, colorClass }) {
  const dead = isDead(count);
  return (
    <button
      onClick={onClick}
      disabled={disabled || dead}
      className={[
        "w-20 h-20 rounded-2xl border-2 flex items-center justify-center transition-all",
        dead
          ? "bg-gray-100 border-gray-200 text-gray-300"
          : `bg-white ${colorClass} ${selected ? "ring-4 ring-amber-300 scale-105" : ""}`,
        disabled || dead ? "cursor-default" : "cursor-pointer hover:scale-105",
      ].join(" ")}
    >
      {dead ? <span className="text-xs font-medium">死亡</span> : <Fingers count={count} />}
    </button>
  );
}

function UltimateWarizashi() {
  const [screen, setScreen] = useState("home"); // home | skillselect | lobby | game
  const [mode, setMode] = useState(null); // 'online' | 'cpu'
  const [ultimate, setUltimate] = useState(false);
  const [code, setCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [playerIndex, setPlayerIndex] = useState(0);
  const [room, setRoom] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [selected, setSelected] = useState(null);
  const [splitVals, setSplitVals] = useState(null);
  const [error, setError] = useState("");
  const peerRef = useRef(null);
  const connRef = useRef(null);
  const actionHandlerRef = useRef(null);
  const hostRef = useRef(false);

  function closeOnline() {
    try { connRef.current?.close(); } catch {}
    try { peerRef.current?.destroy(); } catch {}
    connRef.current = null;
    peerRef.current = null;
    hostRef.current = false;
  }

  function sendOnline(message) {
    if (connRef.current?.open) connRef.current.send(message);
  }

  function broadcastRoom(next) {
    if (hostRef.current && connRef.current?.open) {
      connRef.current.send({ type: "state", room: next });
    }
  }

  // CPUの手番を自動で進める
  useEffect(() => {
    if (mode === "cpu" && room && room.status === "playing" && room.turn === 1) {
      const t = setTimeout(() => cpuTakeTurn(room), 700);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, room]);

  function genCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  function actorName(idx) {
    return mode === "cpu" ? (idx === 0 ? "あなた" : "CPU") : `プレイヤー${idx + 1}`;
  }

  async function handleCreate() {
    closeOnline();
    const newCode = genCode();
    setMode("online");
    setUltimate(false);
    setCode(newCode);
    setPlayerIndex(0);
    hostRef.current = true;
    const initial = {
      status: "waiting",
      players: [{ hands: [1, 1] }],
      turn: 0,
      winner: null,
      log: ["部屋を作成しました。対戦相手を待っています…"],
      updatedAt: Date.now(),
    };
    setRoom(initial);
    setScreen("lobby");
    try {
      const peer = new Peer(`warizashi-${newCode}`);
      peerRef.current = peer;
      peer.on("error", () => setError("通信の初期化に失敗しました。もう一度部屋を作ってください。"));
      peer.on("connection", (conn) => {
        if (connRef.current) { conn.close(); return; }
        connRef.current = conn;
        conn.on("open", () => conn.send({ type: "join" }));
        conn.on("data", (message) => {
          if (message?.type === "join") {
            setRoom((current) => {
              if (!current || current.players.length >= 2) return current;
              const next = JSON.parse(JSON.stringify(current));
              next.players.push({ hands: [1, 1] });
              next.status = "playing";
              next.log.push("対戦相手が参加しました。ゲーム開始!");
              next.updatedAt = Date.now();
              conn.send({ type: "state", room: next });
              return next;
            });
            setScreen("game");
          } else if (message?.type === "action") {
            actionHandlerRef.current?.(message.action);
          }
        });
        conn.on("close", () => { connRef.current = null; });
      });
    } catch (e) {
      setError("部屋の作成に失敗しました。");
    }
  }

  async function handleJoin() {
    if (!joinCode || joinCode.length < 4) {
      setError("4桁のコードを入力してください。");
      return;
    }
    closeOnline();
    setError("");
    setMode("online");
    setUltimate(false);
    setCode(joinCode);
    setPlayerIndex(1);
    setScreen("lobby");
    hostRef.current = false;
    try {
      const peer = new Peer();
      peerRef.current = peer;
      peer.on("error", () => setError("部屋に接続できませんでした。コードを確認してください。"));
      peer.on("open", () => {
        const conn = peer.connect(`warizashi-${joinCode}`, { reliable: true });
        connRef.current = conn;
        conn.on("open", () => conn.send({ type: "join" }));
        conn.on("data", (message) => {
          if (message?.type === "state") {
            setRoom(message.room);
            if (message.room?.status === "playing" || message.room?.status === "finished") setScreen("game");
          }
        });
        conn.on("close", () => setError("対戦相手との接続が切れました。"));
      });
    } catch (e) {
      setError("参加に失敗しました。");
    }
  }

  // ultimateSkillId が渡されればアルティメットモードでCPU戦を開始
  function handleCpuStart(ultimateSkillId) {
    const isUltimate = !!ultimateSkillId;
    setMode("cpu");
    setUltimate(isUltimate);
    setCode("");
    setPlayerIndex(0);
    const cpuSkill = isUltimate ? randomSkillId() : null;
    setRoom({
      status: "playing",
      players: [
        { hands: [1, 1], skill: ultimateSkillId || null, skillCooldown: 0, shieldActive: false },
        { hands: [1, 1], skill: cpuSkill, skillCooldown: 0, shieldActive: false },
      ],
      turn: 0,
      winner: null,
      log: isUltimate
        ? [`アルティメットモード開始!あなた:${SKILLS[ultimateSkillId].name} / CPU:${SKILLS[cpuSkill].name}`]
        : ["CPU対戦を開始しました。"],
      updatedAt: Date.now(),
    });
    setScreen("game");
  }

  const myTurn = room && room.status === "playing" && room.turn === playerIndex;
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  const opponentLabel = mode === "cpu" ? "CPU" : "相手";

  function resetSelection() {
    setPendingAction(null);
    setSelected(null);
    setSplitVals(null);
  }

  function handleRemoteAction(action) {
    if (!hostRef.current || !room || room.status !== "playing") return;
    if (action?.type === "attack") doAttack(action.myHandIdx, action.targetHandIdx, 1);
    else if (action?.type === "self") doSelfAttack(action.myHandIdx, action.otherHandIdx, 1);
    else if (action?.type === "split") doSplit(action.values, 1);
    else if (action?.type === "skill_double") doSkillDouble(action.myHandIdx, action.targetHandIdx, 1);
    else if (action?.type === "skill_aoe") doSkillAoe(action.ownHandIdx, 1);
    else if (action?.type === "skill") useSkill(1);
  }

  useEffect(() => { actionHandlerRef.current = handleRemoteAction; }, [room, mode, playerIndex]);

  function handleHandClick(pIdx, hIdx) {
    if (!myTurn || !room) return;
    const value = room.players[pIdx]?.hands[hIdx];

    if (pendingAction === "attack" || pendingAction === "skill_double") {
      if (isDead(value)) return;
      if (!selected) {
        if (pIdx !== playerIndex) return;
        setSelected({ p: pIdx, h: hIdx });
      } else {
        if (pIdx !== opponentIndex) return;
        if (isDead(room.players[opponentIndex].hands[hIdx])) return;
        if (pendingAction === "attack") doAttack(selected.h, hIdx);
        else doSkillDouble(selected.h, hIdx);
      }
      return;
    }
    if (pendingAction === "self") {
      if (isDead(value)) return;
      if (!selected) {
        if (pIdx !== playerIndex) return;
        setSelected({ p: pIdx, h: hIdx });
      } else {
        if (pIdx !== playerIndex || hIdx === selected.h) return;
        doSelfAttack(selected.h, hIdx);
      }
      return;
    }
    if (pendingAction === "skill_aoe") {
      if (pIdx !== playerIndex || isDead(value)) return;
      doSkillAoe(hIdx);
      return;
    }
  }

  function doAttack(myHandIdx, targetHandIdx, actorIdx = playerIndex) {
    if (!hostRef.current && mode === "online") {
      sendOnline({ type: "action", action: { type: "attack", myHandIdx, targetHandIdx } });
      resetSelection();
      return;
    }
    const next = JSON.parse(JSON.stringify(room));
    const atk = next.players[actorIdx].hands[myHandIdx];
    if (next.players[actorIdx === 0 ? 1 : 0].shieldActive) {
      next.log.push(`${actorName(actorIdx === 0 ? 1 : 0)}の無敵化でブロックされた!`);
    } else {
      const tgt = next.players[actorIdx === 0 ? 1 : 0].hands[targetHandIdx];
      const result = (tgt + atk) % MAX;
      next.players[actorIdx === 0 ? 1 : 0].hands[targetHandIdx] = result;
      next.log.push(`${actorName(actorIdx)}が攻撃!${actorIdx === 0 ? "相手" : "あなた"}の手が${tgt}→${result}本に。`);
    }
    applyResult(next, actorIdx);
  }

  function doSelfAttack(myHandIdx, otherHandIdx, actorIdx = playerIndex) {
    if (!hostRef.current && mode === "online") {
      sendOnline({ type: "action", action: { type: "self", myHandIdx, otherHandIdx } });
      resetSelection();
      return;
    }
    const next = JSON.parse(JSON.stringify(room));
    const atk = next.players[actorIdx].hands[myHandIdx];
    const own = next.players[actorIdx].hands[otherHandIdx];
    const result = (own + atk) % MAX;
    next.players[actorIdx].hands[otherHandIdx] = result;
    next.log.push(`${actorName(actorIdx)}が自分に攻撃!自分の手が${own}→${result}本に。`);
    applyResult(next, actorIdx);
  }

  function doSplit(values = splitVals, actorIdx = playerIndex) {
    if (!hostRef.current && mode === "online") {
      if (values) sendOnline({ type: "action", action: { type: "split", values } });
      resetSelection();
      return;
    }
    if (!values) return;
    const [a, b] = values;
    const current = room.players[actorIdx].hands;
    if (a === current[0] && b === current[1]) {
      setError("配分が変わっていません。");
      return;
    }
    const next = JSON.parse(JSON.stringify(room));
    next.players[actorIdx].hands = [a, b];
    next.log.push(`${actorName(actorIdx)}が分裂!手を${a}本と${b}本に配分。`);
    applyResult(next, actorIdx);
  }

  function doSkillDouble(attackerHandIdx, targetHandIdx, actorIdx = playerIndex) {
    if (!hostRef.current && mode === "online") {
      sendOnline({ type: "action", action: { type: "skill_double", myHandIdx: attackerHandIdx, targetHandIdx } });
      resetSelection();
      return;
    }
    const next = JSON.parse(JSON.stringify(room));
    const atk = next.players[actorIdx].hands[attackerHandIdx] * 2;
    if (next.players[actorIdx === 0 ? 1 : 0].shieldActive) {
      next.log.push(`${actorName(actorIdx === 0 ? 1 : 0)}の無敵化でブロックされた!`);
    } else {
      const tgt = next.players[actorIdx === 0 ? 1 : 0].hands[targetHandIdx];
      const result = (tgt + atk) % MAX;
      next.players[actorIdx === 0 ? 1 : 0].hands[targetHandIdx] = result;
      next.log.push(`${actorName(actorIdx)}のスキル「攻撃力2倍」!相手の手が${tgt}→${result}本に。`);
    }
    next.players[actorIdx].skillCooldown = SKILLS.double.cd;
    applySkillEffect(next, actorIdx);
  }

  function doSkillAoe(ownHandIdx, actorIdx = playerIndex) {
    if (!hostRef.current && mode === "online") {
      sendOnline({ type: "action", action: { type: "skill_aoe", ownHandIdx } });
      resetSelection();
      return;
    }
    const next = JSON.parse(JSON.stringify(room));
    const atkVal = next.players[actorIdx].hands[ownHandIdx];
    if (next.players[actorIdx === 0 ? 1 : 0].shieldActive) {
      next.log.push(`${actorName(actorIdx === 0 ? 1 : 0)}の無敵化でブロックされた!`);
    } else {
      next.players[actorIdx === 0 ? 1 : 0].hands = next.players[actorIdx === 0 ? 1 : 0].hands.map((v) =>
        v === 0 ? 0 : (v + atkVal) % MAX
      );
      next.log.push(`${actorName(actorIdx)}のスキル「全体攻撃」!相手の両手を攻撃した。`);
    }
    next.players[actorIdx].skillCooldown = SKILLS.aoe.cd;
    applySkillEffect(next, actorIdx);
  }

  function checkWinner(next, actingIdx, oppIdx) {
    if (bothDead(next.players[oppIdx].hands)) {
      next.status = "finished";
      next.winner = actingIdx;
      next.log.push(`${actorName(actingIdx)}の勝利!`);
      return true;
    }
    if (bothDead(next.players[actingIdx].hands)) {
      next.status = "finished";
      next.winner = oppIdx;
      next.log.push(`${actorName(oppIdx)}の勝利!`);
      return true;
    }
    return false;
  }

  // 通常の行動(攻撃/自分攻撃/分裂)の後:ターンを終了する(「二回攻撃」で延長中なら自分の番を継続)
  function applyResult(next, actingIdx) {
    const oppIdx = actingIdx === 0 ? 1 : 0;
    const finished = checkWinner(next, actingIdx, oppIdx);
    if (!finished) {
      if (next.players[actingIdx].extraTurns > 0) {
        next.players[actingIdx].extraTurns -= 1;
        next.turn = actingIdx;
        next.log.push(`${actorName(actingIdx)}はもう一度行動できる!`);
      } else {
        next.turn = oppIdx;
        if (ultimate) {
          next.players[oppIdx].shieldActive = false;
          if (next.players[oppIdx].skillCooldown > 0) next.players[oppIdx].skillCooldown -= 1;
        }
      }
    }
    if (mode === "online" && hostRef.current) broadcastRoom(next);
    setRoom(next);
    if (actingIdx === playerIndex) resetSelection();
  }

  // スキル行動の後:ターンは終了しない(通常行動がまだ残っている)
  function applySkillEffect(next, actingIdx) {
    const oppIdx = actingIdx === 0 ? 1 : 0;
    checkWinner(next, actingIdx, oppIdx);
    if (mode === "online" && hostRef.current) broadcastRoom(next);
    setRoom(next);
    if (actingIdx === playerIndex) resetSelection();
  }

  function cpuUseSkill(nextIn) {
    const next = nextIn;
    const cpu = next.players[1];
    const human = next.players[0];
    const skillId = cpu.skill;

    if (skillId === "invincible") {
      next.players[1].shieldActive = true;
      next.log.push("CPUがスキル「無敵化」を発動!");
    } else if (skillId === "double") {
      const ci = cpu.hands.findIndex((v) => v > 0);
      const hi = human.hands.findIndex((v) => v > 0);
      if (ci !== -1 && hi !== -1) {
        if (human.shieldActive) {
          next.log.push("あなたの無敵化でブロックされた!");
        } else {
          const atk = cpu.hands[ci] * 2;
          const tgt = human.hands[hi];
          const result = (tgt + atk) % MAX;
          next.players[0].hands[hi] = result;
          next.log.push(`CPUのスキル「攻撃力2倍」!あなたの手が${tgt}→${result}本に。`);
        }
      }
    } else if (skillId === "aoe") {
      const ci = cpu.hands.findIndex((v) => v > 0);
      if (ci !== -1) {
        if (human.shieldActive) {
          next.log.push("あなたの無敵化でブロックされた!");
        } else {
          const atk = cpu.hands[ci];
          next.players[0].hands = human.hands.map((v) => (v === 0 ? 0 : (v + atk) % MAX));
          next.log.push("CPUのスキル「全体攻撃」!あなたの両手を攻撃した。");
        }
      }
    } else if (skillId === "twice") {
      next.players[1].extraTurns = (next.players[1].extraTurns || 0) + 1;
      next.log.push("CPUがスキル「二回攻撃」を発動!もう一度CPUの番が続く。");
    }
    next.players[1].skillCooldown = SKILLS[skillId].cd;
    checkWinner(next, 1, 0);
    return next;
  }

  function cpuTakeTurn(current) {
    if (!current || current.status !== "playing") return;
    let next = JSON.parse(JSON.stringify(current));

    if (ultimate && next.players[1].skill && next.players[1].skillCooldown === 0) {
      next = cpuUseSkill(next);
      if (next.status === "finished") {
        if (mode === "online") broadcastRoom(next);
        setRoom(next);
        return;
      }
    }

    const cpu = next.players[1];
    const human = next.players[0];

    // 死んだ手があれば分裂で復活を試みる
    const deadIdx = cpu.hands.findIndex((v) => v === 0);
    if (deadIdx !== -1) {
      const aliveIdx = deadIdx === 0 ? 1 : 0;
      const total = cpu.hands[aliveIdx];
      if (total >= 2) {
        const a = Math.floor(total / 2);
        const b = total - a;
        next.players[1].hands = deadIdx === 0 ? [a, b] : [b, a];
        next.log.push(`CPUが分裂!手を${next.players[1].hands[0]}本と${next.players[1].hands[1]}本に配分。`);
        applyResult(next, 1);
        return;
      }
    }

    let best = null;
    for (let ci = 0; ci < 2; ci++) {
      if (cpu.hands[ci] === 0) continue;
      for (let hi = 0; hi < 2; hi++) {
        if (human.hands[hi] === 0) continue;
        const result = (human.hands[hi] + cpu.hands[ci]) % MAX;
        const score = result === 0 ? 100 : result;
        if (!best || score > best.score || (score === best.score && Math.random() < 0.5)) {
          best = { ci, hi, result, score };
        }
      }
    }
    if (best) {
      if (human.shieldActive) {
        next.log.push("あなたの無敵化でブロックされた!");
      } else {
        const before = next.players[0].hands[best.hi];
        next.players[0].hands[best.hi] = best.result;
        next.log.push(`CPUが攻撃!あなたの手が${before}→${best.result}本に。`);
      }
    }
    applyResult(next, 1);
  }

  function startSplit() {
    const current = room.players[playerIndex].hands;
    setPendingAction("split");
    setSplitVals([current[0], current[1]]);
    setError("");
  }

  function adjustSplit(delta) {
    if (!splitVals) return;
    const total = splitVals[0] + splitVals[1];
    let a = splitVals[0] + delta;
    let b = total - a;
    if (a < 0 || a > 4 || b < 0 || b > 4) return;
    setSplitVals([a, b]);
  }

  function useSkill(actorIdx = playerIndex) {
    if (!hostRef.current && mode === "online") {
      sendOnline({ type: "action", action: { type: "skill" } });
      resetSelection();
      return;
    }
    const skillId = room.players[actorIdx].skill;
    if (skillId === "invincible") {
      const next = JSON.parse(JSON.stringify(room));
      next.players[actorIdx].shieldActive = true;
      next.players[actorIdx].skillCooldown = SKILLS.invincible.cd;
      next.log.push(`${actorName(actorIdx)}がスキル「無敵化」を発動!`);
      applySkillEffect(next, actorIdx);
    } else if (skillId === "double") {
      resetSelection();
      setPendingAction("skill_double");
    } else if (skillId === "aoe") {
      resetSelection();
      setPendingAction("skill_aoe");
    } else if (skillId === "twice") {
      const next = JSON.parse(JSON.stringify(room));
      next.players[actorIdx].extraTurns = (next.players[actorIdx].extraTurns || 0) + 1;
      next.players[actorIdx].skillCooldown = SKILLS.twice.cd;
      next.log.push(`${actorName(actorIdx)}がスキル「二回攻撃」を発動!もう一度行動できる。`);
      applySkillEffect(next, actorIdx);
    }
  }

  // ---------- 画面: ホーム ----------
  if (screen === "home") {
    return (
      <div className="min-h-[500px] flex flex-col items-center justify-center gap-6 bg-slate-50 rounded-3xl p-8">
        <h1 className="text-2xl font-bold text-slate-800">アルティメット割り箸</h1>
        <p className="text-sm text-slate-500">モードを選んでください</p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={handleCreate}
            className="bg-blue-600 text-white rounded-xl py-3 font-medium hover:bg-blue-700"
          >
            部屋を作る(ノーマル・オンライン)
          </button>
          <button
            onClick={() => handleCpuStart(null)}
            className="bg-slate-700 text-white rounded-xl py-3 font-medium hover:bg-slate-800"
          >
            CPU対戦(ノーマル)
          </button>
          <button
            onClick={() => setScreen("skillselect")}
            className="bg-violet-600 text-white rounded-xl py-3 font-medium hover:bg-violet-700"
          >
            アルティメットモード(CPU)
          </button>
          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="4桁のコード"
              className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-center tracking-widest"
            />
            <button
              onClick={handleJoin}
              className="bg-rose-600 text-white rounded-xl px-4 font-medium hover:bg-rose-700"
            >
              参加
            </button>
          </div>
          {error && <p className="text-rose-500 text-sm text-center">{error}</p>}
        </div>
      </div>
    );
  }

  // ---------- 画面: スキル選択 ----------
  if (screen === "skillselect") {
    return (
      <div className="min-h-[500px] flex flex-col items-center justify-center gap-5 bg-slate-50 rounded-3xl p-8">
        <p className="text-sm text-slate-500">使用するスキルを1つ選んでください</p>
        <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
          {SKILL_LIST.map((s) => (
            <button
              key={s.id}
              onClick={() => handleCpuStart(s.id)}
              className="bg-white border-2 border-slate-200 hover:border-violet-400 rounded-2xl p-4 text-left transition-all"
            >
              <div className="font-bold text-slate-800">{s.name}</div>
              <div className="text-xs text-slate-500 mt-1">{s.desc}</div>
              <div className="text-xs text-violet-500 mt-1">CT: {s.cd}ターン</div>
            </button>
          ))}
        </div>
        <button onClick={() => setScreen("home")} className="text-xs text-slate-400 underline">
          戻る
        </button>
      </div>
    );
  }

  // ---------- 画面: ロビー ----------
  if (screen === "lobby") {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center gap-4 bg-slate-50 rounded-3xl p-8">
        <p className="text-slate-500">この部屋コードを相手に伝えてください</p>
        <div className="text-5xl font-bold tracking-widest text-blue-600">{code}</div>
        <p className="text-sm text-slate-400 animate-pulse">対戦相手を待っています…</p>
      </div>
    );
  }

  // ---------- 画面: ゲーム ----------
  if (!room) return null;
  const me = room.players[playerIndex];
  const opp = room.players[opponentIndex];
  const finished = room.status === "finished";
  const opponentHandClickable =
    myTurn && !finished && ["attack", "skill_double"].includes(pendingAction);
  const myHandDisabledExtra = ["attack", "skill_double"].includes(pendingAction) && selected;

  return (
    <div className="min-h-[600px] flex flex-col bg-slate-50 rounded-3xl p-6 gap-4">
      {/* 相手 */}
      <div className="flex flex-col items-center gap-2">
        <div className={`text-xs font-medium flex items-center gap-1 ${!myTurn && !finished ? "text-rose-600" : "text-slate-400"}`}>
          {opponentLabel} {!myTurn && !finished ? "(手番)" : ""}
          {opp?.shieldActive && <span title="無敵化中">🛡️</span>}
        </div>
        <div className="flex gap-4">
          {opp
            ? opp.hands.map((v, i) => (
                <Hand
                  key={i}
                  count={v}
                  colorClass="border-rose-300 text-rose-500"
                  selected={selected && selected.p === opponentIndex && selected.h === i}
                  disabled={!opponentHandClickable}
                  onClick={() => handleHandClick(opponentIndex, i)}
                />
              ))
            : <div className="text-slate-400 text-sm">接続待ち…</div>}
        </div>
        {ultimate && opp && (
          <div className="text-[11px] text-slate-400">
            スキル:{SKILLS[opp.skill]?.name}{opp.skillCooldown > 0 ? `(あと${opp.skillCooldown}ターン)` : "(使用可)"}
          </div>
        )}
      </div>

      {/* ログ */}
      <div className="flex-1 bg-white rounded-xl border border-slate-200 p-3 overflow-y-auto text-xs text-slate-500 space-y-1 max-h-24">
        {room.log.slice(-6).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>

      {/* 自分 */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex gap-4">
          {me.hands.map((v, i) => (
            <Hand
              key={i}
              count={v}
              colorClass="border-blue-300 text-blue-500"
              selected={selected && selected.p === playerIndex && selected.h === i}
              disabled={!myTurn || finished || myHandDisabledExtra}
              onClick={() => handleHandClick(playerIndex, i)}
            />
          ))}
        </div>
        <div className={`text-xs font-medium flex items-center gap-1 ${myTurn && !finished ? "text-blue-600" : "text-slate-400"}`}>
          あなた {myTurn && !finished ? "(手番)" : ""}
          {me.shieldActive && <span title="無敵化中">🛡️</span>}
        </div>
        {ultimate && (
          <div className="text-[11px] text-slate-400">
            スキル:{SKILLS[me.skill]?.name}{me.skillCooldown > 0 ? `(あと${me.skillCooldown}ターン)` : "(使用可)"}
          </div>
        )}
      </div>

      {/* アクションパネル */}
      {!finished && (
        <div className="flex flex-col items-center gap-2 pt-2 border-t border-slate-200">
          {!myTurn && <p className="text-sm text-slate-400">{opponentLabel}の手番です…</p>}
          {myTurn && !pendingAction && (
            <div className="flex flex-wrap justify-center gap-2">
              <button
                onClick={() => { resetSelection(); setPendingAction("attack"); }}
                className="bg-rose-500 text-white text-sm rounded-lg px-4 py-2 hover:bg-rose-600"
              >
                攻撃
              </button>
              <button
                onClick={() => { resetSelection(); setPendingAction("self"); }}
                className="bg-amber-500 text-white text-sm rounded-lg px-4 py-2 hover:bg-amber-600"
              >
                自分に攻撃
              </button>
              <button
                onClick={startSplit}
                className="bg-emerald-500 text-white text-sm rounded-lg px-4 py-2 hover:bg-emerald-600"
              >
                分裂
              </button>
              {ultimate && me.skillCooldown === 0 && (
                <button
                  onClick={useSkill}
                  className="bg-violet-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-violet-700"
                >
                  スキル:{SKILLS[me.skill]?.name}
                </button>
              )}
            </div>
          )}
          {myTurn && (pendingAction === "attack" || pendingAction === "self" || pendingAction === "skill_double") && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-slate-500">
                {!selected
                  ? "自分の手を選んでください"
                  : pendingAction === "self"
                  ? "もう片方の自分の手を選んでください"
                  : "相手の手を選んでください"}
              </p>
              <button onClick={resetSelection} className="text-xs text-slate-400 underline">キャンセル</button>
            </div>
          )}
          {myTurn && pendingAction === "skill_aoe" && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-slate-500">攻撃に使う自分の手を選んでください(相手の両手に命中)</p>
              <button onClick={resetSelection} className="text-xs text-slate-400 underline">キャンセル</button>
            </div>
          )}
          {myTurn && pendingAction === "split" && splitVals && (
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center gap-1">
                  <button onClick={() => adjustSplit(1)} className="text-slate-400 hover:text-slate-700">▲</button>
                  <div className="w-12 h-12 rounded-xl bg-white border-2 border-blue-300 flex items-center justify-center font-bold text-blue-600">
                    {splitVals[0]}
                  </div>
                  <button onClick={() => adjustSplit(-1)} className="text-slate-400 hover:text-slate-700">▼</button>
                </div>
                <span className="text-slate-400">/</span>
                <div className="w-12 h-12 rounded-xl bg-white border-2 border-blue-300 flex items-center justify-center font-bold text-blue-600">
                  {splitVals[1]}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={doSplit} className="bg-emerald-500 text-white text-sm rounded-lg px-4 py-2 hover:bg-emerald-600">決定</button>
                <button onClick={resetSelection} className="text-xs text-slate-400 underline">キャンセル</button>
              </div>
            </div>
          )}
        </div>
      )}

      {finished && (
        <div className="text-center py-2">
          <p className="text-lg font-bold text-slate-700">
            {room.winner === playerIndex ? "あなたの勝ち!" : "あなたの負け…"}
          </p>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(UltimateWarizashi));
