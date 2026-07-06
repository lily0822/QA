import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import { doc, onSnapshot, runTransaction, setDoc } from 'firebase/firestore'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Clock3,
  ExternalLink,
  Pencil,
  Plus,
  Save,
  Settings,
  SunMoon,
  Trash2,
  UserRound,
  Utensils,
  X,
} from 'lucide-react'
import { auth, db } from './firebase'

type Member = { id: string; name: string }
type Grid = Record<number, Record<string, boolean>>
type MonthData = {
  members: Member[]
  grid: Grid
  holidayOverrides: Record<number, boolean>
  restaurant: string
  time: string
  mealPeriod: string
  link: string
}

const DEFAULT_MEMBERS: Member[] = [
  'Joey', 'Peter', 'Leo', 'Arsene', 'Jir', 'Mincy', 'Ralf',
  'Lily', 'Ben', 'Morris', 'Rose', 'Asher', 'Lydia', 'Lisa',
].map((name, index) => ({ id: String(index + 1), name }))

const emptyData = (): MonthData => ({
  members: DEFAULT_MEMBERS,
  grid: {},
  holidayOverrides: {},
  restaurant: '',
  time: '',
  mealPeriod: '',
  link: '',
})

const keyFor = (year: number, month: number) => `qa-food:${year}-${month}`

function loadMonth(year: number, month: number): MonthData {
  try {
    const value = localStorage.getItem(keyFor(year, month))
    return value ? { ...emptyData(), ...JSON.parse(value) } : emptyData()
  } catch {
    return emptyData()
  }
}

export default function QA() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<MonthData>(() => loadMonth(now.getFullYear(), now.getMonth() + 1))
  const [selectedMember, setSelectedMember] = useState('')
  const [newMember, setNewMember] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [editingDinner, setEditingDinner] = useState(false)
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [syncStatus, setSyncStatus] = useState<'connecting' | 'synced' | 'error'>('connecting')
  const isLily = data.members.find(({ id }) => id === selectedMember)?.name === 'Lily'

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user)
      if (user) setSyncStatus('connecting')
    })

    signInAnonymously(auth).catch((error) => {
      console.error('Firebase anonymous sign-in failed:', error)
      setSyncStatus('error')
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    setData(loadMonth(year, month))
    setSelectedMember('')
  }, [year, month])

  useEffect(() => {
    if (!firebaseUser) return

    setSyncStatus('connecting')
    const monthRef = doc(db, 'months', `${year}-${month.toString().padStart(2, '0')}`)
    const unsubscribe = onSnapshot(monthRef, (snapshot) => {
      if (snapshot.exists()) {
        setData({ ...emptyData(), ...snapshot.data() } as MonthData)
        setSyncStatus('synced')
        return
      }

      const localData = loadMonth(year, month)
      setDoc(monthRef, localData)
        .then(() => setSyncStatus('synced'))
        .catch((error) => {
          console.error('Firebase initial save failed:', error)
          setSyncStatus('error')
        })
    }, (error) => {
      console.error('Firebase realtime sync failed:', error)
      setSyncStatus('error')
    })

    return unsubscribe
  }, [firebaseUser, year, month])

  useEffect(() => {
    localStorage.setItem(keyFor(year, month), JSON.stringify(data))
  }, [data, year, month])

  useEffect(() => {
    if (!isLily) {
      setShowSettings(false)
      setEditingDinner(false)
    }
  }, [isLily])

  const days = new Date(year, month, 0).getDate()
  const weekday = (day: number) => ['日', '一', '二', '三', '四', '五', '六'][new Date(year, month - 1, day).getDay()]
  const isHoliday = (day: number) => {
    if (data.holidayOverrides[day] !== undefined) return data.holidayOverrides[day]
    const value = new Date(year, month - 1, day).getDay()
    return value === 0 || value === 6
  }

  const unavailableCount = useMemo(() => {
    const result: Record<number, number> = {}
    for (let day = 1; day <= days; day++) {
      result[day] = data.members.filter((member) => data.grid[day]?.[member.id]).length
    }
    return result
  }, [data.grid, data.members, days])

  const rankedDays = useMemo(() => (
    Array.from({ length: days }, (_, index) => index + 1)
      .filter((day) => !isHoliday(day) && (unavailableCount[day] ?? 0) > 0)
      .map((day) => ({
        day,
        unavailable: unavailableCount[day] ?? 0,
        available: data.members.length - (unavailableCount[day] ?? 0),
      }))
      .sort((a, b) => a.unavailable - b.unavailable || a.day - b.day)
  ), [days, data.members.length, unavailableCount, data.holidayOverrides, year, month])

  const update = (patch: Partial<MonthData>) => {
    setData((current) => ({ ...current, ...patch }))
    if (!firebaseUser) return

    setSyncStatus('connecting')
    const monthRef = doc(db, 'months', `${year}-${month.toString().padStart(2, '0')}`)
    setDoc(monthRef, patch, { merge: true })
      .then(() => setSyncStatus('synced'))
      .catch((error) => {
        console.error('Firebase save failed:', error)
        setSyncStatus('error')
      })
  }

  const moveMonth = (direction: number) => {
    const date = new Date(year, month - 1 + direction, 1)
    setYear(date.getFullYear())
    setMonth(date.getMonth() + 1)
  }

  const toggleCell = (day: number, memberId: string) => {
    if (isHoliday(day)) return
    const nextValue = !data.grid[day]?.[memberId]
    const nextGrid = {
      ...data.grid,
      [day]: { ...data.grid[day], [memberId]: nextValue },
    }
    setData((current) => ({ ...current, grid: nextGrid }))

    if (!firebaseUser) return
    setSyncStatus('connecting')
    const monthRef = doc(db, 'months', `${year}-${month.toString().padStart(2, '0')}`)
    runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(monthRef)
      const cloudData = snapshot.exists() ? snapshot.data() as Partial<MonthData> : emptyData()
      const cloudGrid = cloudData.grid ?? {}
      transaction.set(monthRef, {
        grid: {
          ...cloudGrid,
          [day]: { ...cloudGrid[day], [memberId]: nextValue },
        },
      }, { merge: true })
    })
      .then(() => setSyncStatus('synced'))
      .catch((error) => {
        console.error('Firebase cell update failed:', error)
        setSyncStatus('error')
      })
  }

  const toggleHoliday = (day: number) => {
    update({
      holidayOverrides: { ...data.holidayOverrides, [day]: !isHoliday(day) },
      grid: isHoliday(day) ? data.grid : { ...data.grid, [day]: {} },
    })
  }

  const addMember = () => {
    if (!isLily) return
    const name = newMember.trim()
    if (!name) return
    update({ members: [...data.members, { id: crypto.randomUUID(), name }] })
    setNewMember('')
  }

  const removeMember = (member: Member) => {
    if (!isLily) return
    if (!window.confirm(`確定要移除 ${member.name} 嗎？`)) return
    const grid = Object.fromEntries(
      Object.entries(data.grid).map(([day, values]) => {
        const next = { ...values }
        delete next[member.id]
        return [day, next]
      }),
    )
    update({ members: data.members.filter(({ id }) => id !== member.id), grid })
    if (selectedMember === member.id) setSelectedMember('')
  }

  return (
    <div className="app-shell">
      <header className="hero card">
        <div className="brand">
          <span className="brand-icon"><CalendarDays /></span>
          <div>
            <h1>測試部團建</h1>
            <span className={`sync-badge ${syncStatus}`}>
              {syncStatus === 'synced' ? <Cloud /> : <CloudOff />}
              {syncStatus === 'synced' ? '雲端即時同步中' : syncStatus === 'connecting' ? '正在同步…' : '同步失敗'}
            </span>
          </div>
        </div>
        <div className="month-switcher" aria-label="月份切換">
          <button className="icon-button" onClick={() => moveMonth(-1)} aria-label="上個月"><ChevronLeft /></button>
          <div><strong>{year}</strong><span>{month.toString().padStart(2, '0')} 月</span></div>
          <button className="icon-button" onClick={() => moveMonth(1)} aria-label="下個月"><ChevronRight /></button>
        </div>
      </header>

      <main className="layout">
        <section className="calendar card">
          <div className="toolbar">
            <div>
              <h2>出席狀況表</h2>
              <p>點一下日期可切換工作日／休假日；點格子標記無法出席。</p>
            </div>
            <label className="member-select">
              <UserRound size={16} />
              <select value={selectedMember} onChange={(event) => setSelectedMember(event.target.value)}>
                <option value="">我是誰？</option>
                {data.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="sticky name-cell">日期</th>
                  {Array.from({ length: days }, (_, index) => {
                    const day = index + 1
                    const everyoneAvailable = !isHoliday(day) && unavailableCount[day] === 0
                    return (
                      <th
                        key={day}
                        className={isHoliday(day) ? 'holiday' : everyoneAvailable ? 'everyone-available' : ''}
                        onClick={() => toggleHoliday(day)}
                      >
                        <span>{month}/{day}</span><small>{weekday(day)}</small>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {data.members.map((member) => (
                  <tr key={member.id} className={selectedMember === member.id ? 'selected-row' : ''}>
                    <td className="sticky name-cell">{member.name}</td>
                    {Array.from({ length: days }, (_, index) => {
                      const day = index + 1
                      const checked = Boolean(data.grid[day]?.[member.id])
                      return (
                        <td key={day} className={isHoliday(day) ? 'holiday' : ''} onClick={() => toggleCell(day, member.id)}>
                          {isHoliday(day) ? <span className="dash">—</span> : <span className={`check ${checked ? 'checked' : ''}`}>{checked ? '✓' : ''}</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="summary-row">
                  <td className="sticky name-cell">無法出席</td>
                  {Array.from({ length: days }, (_, index) => {
                    const day = index + 1
                    return <td key={day} className={isHoliday(day) ? 'holiday' : ''}>{isHoliday(day) ? '—' : unavailableCount[day]}</td>
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="legend"><span><i className="legend-box" /> 可以出席</span><span><i className="legend-box active" /> 無法出席</span><span>所有資料自動儲存在這台裝置</span></div>
        </section>

        <aside>
          <section className="card ranking">
            <div className="section-title stats-title"><span>✣</span><h2>工作日無法參加統計</h2></div>
            <div className="stats-head">
              <span>日期 ↕</span>
              <strong>不參加 ▲</strong>
              <span>可參加 ↕</span>
            </div>
            {rankedDays.length === 0 ? (
              <div className="all-available-message">
                🎉 太棒了！本月目前所有工作日大家<br />都可以參加！
              </div>
            ) : (
              <div className="stats-list">
                {rankedDays.map((item) => (
                  <div className="stats-row" key={item.day}>
                    <span>{month}/{item.day.toString().padStart(2, '0')}（{weekday(item.day)}）</span>
                    <strong>{item.unavailable} 人</strong>
                    <span>{item.available} 人</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card members">
            <div className="section-title with-action">
              <div className="title-group"><Settings /><div><h2>成員管理</h2><p>{data.members.length} 位成員</p></div></div>
              {isLily ? (
                <button className="text-button" onClick={() => setShowSettings((value) => !value)}>{showSettings ? '完成' : '編輯'}</button>
              ) : (
                <span className="permission-note">僅 Lily 可編輯</span>
              )}
            </div>
            {showSettings && (
              <div className="add-member">
                <input value={newMember} onChange={(event) => setNewMember(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addMember()} placeholder="輸入成員名稱" maxLength={20} />
                <button onClick={addMember} aria-label="新增成員"><Plus /></button>
              </div>
            )}
            <div className="member-chips">
              {data.members.map((member) => (
                <span key={member.id} className={selectedMember === member.id ? 'active' : ''}>
                  {member.name}
                  {showSettings && <button onClick={() => removeMember(member)} aria-label={`移除 ${member.name}`}><Trash2 /></button>}
                </span>
              ))}
            </div>
          </section>
        </aside>
      </main>

      <section className="dinner card">
        <div className="section-title with-action">
          <div className="title-group"><Utensils /><div><h2>聚餐資訊</h2><p>把餐廳、時間和連結放在一起</p></div></div>
          {isLily ? (
            <button className="text-button" onClick={() => setEditingDinner((value) => !value)}>
              {editingDinner ? <><X />完成</> : <><Pencil />編輯資訊</>}
            </button>
          ) : (
            <span className="permission-note">僅 Lily 可編輯</span>
          )}
        </div>
        <div className="dinner-grid">
          <DinnerField icon={<Utensils />} label="餐廳" value={data.restaurant} editing={editingDinner} placeholder="例如：小器食堂" onChange={(restaurant) => update({ restaurant })} />
          <DinnerField icon={<Clock3 />} label="時間" value={data.time} editing={editingDinner} placeholder="例如：7/25 18:30" onChange={(time) => update({ time })} />
          <DinnerSelect icon={<SunMoon />} label="時段" value={data.mealPeriod} editing={editingDinner} onChange={(mealPeriod) => update({ mealPeriod })} />
          <DinnerField icon={<ExternalLink />} label="餐廳連結" value={data.link} editing={editingDinner} placeholder="貼上 Google Maps 網址" onChange={(link) => update({ link })} link />
        </div>
      </section>

      <footer>Made for good food and easy plans.</footer>
    </div>
  )
}

function DinnerSelect({ icon, label, value, editing, onChange }: {
  icon: React.ReactNode
  label: string
  value: string
  editing: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="dinner-field">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        {editing ? (
          <select value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">請選擇</option>
            <option value="中午">中午</option>
            <option value="晚上">晚上</option>
          </select>
        ) : <strong className={!value ? 'muted' : ''}>{value || '尚未設定'}</strong>}
      </div>
    </div>
  )
}

function DinnerField({ icon, label, value, editing, placeholder, onChange, link = false }: {
  icon: React.ReactNode
  label: string
  value: string
  editing: boolean
  placeholder: string
  onChange: (value: string) => void
  link?: boolean
}) {
  return (
    <div className="dinner-field">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        {editing ? (
          <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        ) : link && value ? (
          <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noreferrer">開啟餐廳連結 <ExternalLink /></a>
        ) : <strong className={!value ? 'muted' : ''}>{value || '尚未設定'}</strong>}
      </div>
    </div>
  )
}
