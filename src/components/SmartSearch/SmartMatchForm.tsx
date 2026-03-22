import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Search, X, ChevronDown, CornerUpLeft } from 'react-feather'
import {
  MatchFormConfig,
  MatchFormValues,
  ImportantQuestionConfig,
  MatchFormFieldConfig,
} from '../../model'
import {
  searchFields,
  getAllFieldsForBrowse,
  getRelatedSuggestions,
  TEMPLATES,
  ScoredField,
} from './searchEngine'
import {
  clearShowIfField,
  getDefaultValues,
  getIsFieldShowing,
} from '../../utils'
import Field from '../Inputs/Field'
import FieldWrapper from '../FieldWrapper'
import DropdownSection from '../DropdownSection'

const HighlightMatch = ({ text, query }: { text: string; query: string }) => {
  if (!query.trim() || !text) return <>{text}</>
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1) // don't highlight single letters
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // escape regex

  if (words.length === 0) return <>{text}</>
  const regex = new RegExp(`(${words.join('|')})`, 'gi')
  const parts = text.split(regex)

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = words.some((w) => new RegExp(`^${w}$`, 'i').test(part))
        return isMatch ? (
          <strong key={i} className="font-extrabold text-primary">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      })}
    </>
  )
}

export type SmartMatchFormProps = {
  config: MatchFormConfig
  matchInput: MatchFormValues
  isFilterActive: boolean
  updateMatchInput(values: MatchFormValues): void
  setIsUpdating: React.Dispatch<React.SetStateAction<boolean>>
  importantQuestionsConfig: ImportantQuestionConfig
}

export default function SmartMatchForm({
  config,
  matchInput,
  updateMatchInput,
  setIsUpdating,
  importantQuestionsConfig,
  isFilterActive,
}: SmartMatchFormProps) {
  // ── Local form values (mirrors original MatchForm) ──────────────
  const [values, setValues] = useState<MatchFormValues>(() =>
    getDefaultValues(config)
  )
  useEffect(() => setValues({ ...matchInput }), [matchInput])

  // ── Explicitly-selected field IDs ───────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => {
    const ids = new Set<number>()
    for (const key of Object.keys(matchInput)) {
      const id = Number(key)
      const val = matchInput[id]
      if (val !== undefined && val !== '' && val !== null) {
        ids.add(id)
      }
    }
    return ids
  })

  // ── Search & UI state ───────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [activeGroup, setActiveGroup] = useState<number | null>(null)
  const [focusIdx, setFocusIdx] = useState(-1)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // ── Undo history ────────────────────────────────────────────────
  const [history, setHistory] = useState<
    { values: MatchFormValues; ids: number[] }[]
  >([])
  const [relSuggestion, setRelSuggestion] = useState<{
    source: string
    fields: ScoredField[]
    reason: string
  } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const listboxRef = useRef<HTMLUListElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | undefined>()

  // ── Hierarchy & Rendering Logic ─────────────────────────────────

  // Determine the single "primary" parent for any field to form a true tree.
  const getRenderParentId = useCallback(
    (field: MatchFormFieldConfig): number | null => {
      if (!field.showIf || field.showIf.criteria.length === 0) return null
      return field.showIf.criteria[0].id
    },
    []
  )

  // Calculate the FULL set of fields that should be visibly rendered on screen.
  // This includes user-selected fields AND any children that automatically satisfy `showIf`.
  const visibleFieldsSet = useMemo(() => {
    const set = new Set<number>()
    // 1. Add all explicitly selected root IDs (filtered by relevance if active)
    for (const id of selectedIds) {
      const f = config.fields.find((field) => field.id === id)
      if (f && (!isFilterActive || f.relevant)) {
        set.add(id)
      }
    }

    let changed = true
    while (changed) {
      changed = false
      for (const f of config.fields) {
        if (!set.has(f.id) && f.showIf) {
          if (isFilterActive && !f.relevant) continue

          const parentId = getRenderParentId(f)
          if (
            parentId &&
            set.has(parentId) &&
            getIsFieldShowing(f.showIf, config, values)
          ) {
            set.add(f.id)
            changed = true
          }
        }
      }
    }
    return set
  }, [selectedIds, config, values, getRenderParentId, isFilterActive])

  // Get children of a specific parent that are in `visibleFieldsSet`
  const getVisibleChildren = useCallback(
    (parentId: number): MatchFormFieldConfig[] => {
      const children: MatchFormFieldConfig[] = []
      for (const id of visibleFieldsSet) {
        const f = config.fields.find((field) => field.id === id)
        if (f && getRenderParentId(f) === parentId) {
          children.push(f)
        }
      }
      return children
    },
    [visibleFieldsSet, config.fields, getRenderParentId]
  )

  // Top-level fields are those in `visibleFieldsSet` that DO NOT have a parent in `visibleFieldsSet`.
  const topLevelFields = useMemo(() => {
    const result: MatchFormFieldConfig[] = []
    for (const id of visibleFieldsSet) {
      const field = config.fields.find((f) => f.id === id)
      if (!field) continue
      const parentId = getRenderParentId(field)
      if (parentId === null || !visibleFieldsSet.has(parentId)) {
        result.push(field)
      }
    }
    return result
  }, [visibleFieldsSet, config.fields, getRenderParentId])

  // Get all ancestor IDs (deep cascade for auto-selecting parents)
  const getAncestors = useCallback(
    (fieldId: number): number[] => {
      const field = config.fields.find((f) => f.id === fieldId)
      if (!field || !field.showIf) return []
      const result: number[] = []
      for (const crit of field.showIf.criteria) {
        result.push(crit.id)
        result.push(...getAncestors(crit.id))
      }
      return Array.from(new Set(result))
    },
    [config.fields]
  )

  // Get all descendant IDs strictly through the `getRenderParentId` tree
  const getDescendants = useCallback(
    (fieldId: number): number[] => {
      const result: number[] = []
      const children = config.fields.filter(
        (f) => getRenderParentId(f) === fieldId
      )
      for (const child of children) {
        result.push(child.id)
        result.push(...getDescendants(child.id))
      }
      return result
    },
    [config.fields, getRenderParentId]
  )

  // ── Search Engine Results ───────────────────────────────────────
  const results = useMemo(() => {
    let list: ScoredField[]
    if (query.trim()) {
      list = searchFields(query, config.fields, config.groups)
    } else {
      list = getAllFieldsForBrowse(config.fields, config.groups)
    }
    if (activeGroup !== null) {
      list = list.filter((r) => r.field.groupId === activeGroup)
    }
    if (isFilterActive) {
      list = list.filter((r) => r.field.relevant)
    }
    return list.filter((r) => !visibleFieldsSet.has(r.field.id))
  }, [query, config, activeGroup, visibleFieldsSet, isFilterActive])

  // ── Save to undo history ────────────────────────────────────────
  const pushHistory = useCallback(() => {
    setHistory((prev) => {
      const next = [
        ...prev,
        { values: { ...values }, ids: Array.from(selectedIds) },
      ]
      return next.length > 10 ? next.slice(-10) : next
    })
  }, [values, selectedIds])

  const undo = () => {
    if (history.length === 0) return
    const last = history[history.length - 1]
    setHistory((prev) => prev.slice(0, -1))
    setSelectedIds(new Set(last.ids))
    setValues(last.values)
    updateMatchInput(clearShowIfField(config, { ...last.values }))
  }

  // ── Commit values to parent ─────────────────────────────────────
  const commitValues = useCallback(
    (newValues: MatchFormValues) => {
      updateMatchInput(clearShowIfField(config, { ...newValues }))
    },
    [config, updateMatchInput]
  )

  // ── Add a field ─────────────────────────────────────────────────
  const addField = useCallback(
    (field: MatchFormFieldConfig) => {
      pushHistory()

      const nextIds = new Set(selectedIds)
      nextIds.add(field.id)

      // Auto-add ALL ancestors (entire parent chain)
      const ancestors = getAncestors(field.id)
      for (const pid of ancestors) {
        nextIds.add(pid)
      }

      setSelectedIds(nextIds)
      setQuery('')
      setDropdownOpen(false)

      const rel = getRelatedSuggestions(
        field.name,
        config.fields,
        config.groups
      )
      if (rel) setRelSuggestion(rel)
    },
    [pushHistory, selectedIds, getAncestors, config]
  )

  // ── Remove a field (cascade to ALL descendants) ─────────────────
  const removeField = useCallback(
    (id: number) => {
      pushHistory()

      const nextIds = new Set(selectedIds)

      // We recursively find all auto-shown or manually selected children from this node down
      // and remove them entirely, simulating a strict hierarchy wipe.
      const removeList = [id, ...getDescendants(id)]

      for (const rId of removeList) {
        nextIds.delete(rId)
      }

      setSelectedIds(nextIds)

      // Clear values for removed fields
      const next = { ...values }
      for (const rId of removeList) {
        delete next[rId]
      }

      setValues(next)
      commitValues(next)
    },
    [pushHistory, selectedIds, getDescendants, values, commitValues]
  )

  // ── Handle field value change ───────────────────────────────────
  const handleChange = useCallback(
    (fieldType: MatchFormFieldConfig['type']) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        if (fieldType === 'checkbox' || fieldType === 'multiselect') return

        const { name, value } = e.target
        const isNumberValue = fieldType === 'select' || fieldType === 'radio'
        const isEmptyValue = !value
        const newValues: MatchFormValues = {
          ...values,
          [name]: isEmptyValue ? undefined : isNumberValue ? +value : value,
        }
        setValues(newValues)

        if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current)

        if (formRef?.current?.reportValidity()) {
          setIsUpdating(true)
          timeoutRef.current = setTimeout(() => {
            commitValues(newValues)
            setIsUpdating(false)
          }, 1000)
        } else {
          setIsUpdating(false)
        }
      },
    [values, setIsUpdating, commitValues]
  )

  // ── Keyboard navigation (F11) ──────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!dropdownOpen || !results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(focusIdx + 1, results.length - 1)
      setFocusIdx(next)
      if (listboxRef.current && listboxRef.current.children[next]) {
        ;(listboxRef.current.children[next] as HTMLElement).scrollIntoView({
          block: 'nearest',
        })
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.max(focusIdx - 1, 0)
      setFocusIdx(next)
      if (listboxRef.current && listboxRef.current.children[next]) {
        ;(listboxRef.current.children[next] as HTMLElement).scrollIntoView({
          block: 'nearest',
        })
      }
    } else if (e.key === 'Enter' && focusIdx >= 0) {
      e.preventDefault()
      addField(results[focusIdx].field)
    } else if (e.key === 'Escape') {
      setDropdownOpen(false)
    }
  }

  // ── Template apply (F9) ─────────────────────────────────────────
  const applyTemplate = (fieldNames: string[]) => {
    pushHistory()
    const nextIds = new Set(selectedIds)
    config.fields.forEach((f) => {
      if (fieldNames.includes(f.name)) {
        nextIds.add(f.id)
        const ancestors = getAncestors(f.id)
        for (const pid of ancestors) {
          nextIds.add(pid)
        }
      }
    })
    setSelectedIds(nextIds)
  }

  // ── Helper: type label for dropdown ─────────────────────────────
  const typeLabel = (f: MatchFormFieldConfig) => {
    if (f.type === 'number' || f.type === 'age') return 'Number'
    if (f.type === 'radio' || f.type === 'select')
      return `${f.options?.length || 0} options`
    if (f.type === 'multiselect' || f.type === 'checkbox') return 'Multi-select'
    return 'Text'
  }

  // ── Recursive field renderer ────────────────────────────────────
  const renderField = (
    field: MatchFormFieldConfig,
    depth: number
  ): React.ReactNode => {
    const children = getVisibleChildren(field.id)
    const isChild = depth > 0
    const isConditionMet =
      !field.showIf || getIsFieldShowing(field.showIf, config, values)

    return (
      <div key={field.id}>
        <div
          className={`border p-3 transition-colors ${
            isChild ? 'bg-gray-50' : ''
          } ${
            isConditionMet
              ? 'border-gray-200 hover:border-primary'
              : 'border-dashed border-gray-300 opacity-60'
          }`}
        >
          <div className="flex items-start justify-between mb-2">
            <div
              className={`text-sm font-semibold flex items-center flex-wrap gap-2 ${
                isChild ? 'text-gray-700' : 'text-gray-800'
              }`}
            >
              {field.label || field.name}
              {!isConditionMet && (
                <span className="text-xs font-normal text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded uppercase tracking-wider">
                  Needs Parent Answer
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => removeField(field.id)}
              className="text-gray-300 hover:text-red-500 ml-2 flex-shrink-0"
              title="Remove"
            >
              <X size={14} />
            </button>
          </div>

          <div
            className={isConditionMet ? '' : 'pointer-events-none opacity-50'}
          >
            <FieldWrapper isShowing={true}>
              <Field
                config={{
                  ...field,
                  name: String(field.id),
                  label: undefined,
                  disabled: !field.relevant,
                }}
                value={values[field.id]}
                onChange={handleChange(field.type)}
              />
            </FieldWrapper>
          </div>
        </div>

        {/* Render children logically nested */}
        {children.length > 0 && (
          <div className="ml-4 mt-1 border-l-2 border-gray-200 pl-3 space-y-1">
            {children.map((child) => renderField(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <span className="uppercase text-primary font-bold tracking-wider text-sm">
          Smart Trial Matcher
        </span>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            disabled={history.length === 0}
            onClick={undo}
            className={`flex items-center space-x-1 px-3 py-1 border text-xs uppercase tracking-wider ${
              history.length > 0
                ? 'border-primary text-primary hover:bg-red-50'
                : 'border-gray-300 text-gray-300 cursor-not-allowed'
            }`}
          >
            <CornerUpLeft size={12} /> <span>Undo</span>
          </button>
        </div>
      </div>

      {/* ── Category pills ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-3 relative z-20">
        <button
          type="button"
          onClick={() => {
            setActiveGroup(null)
            inputRef.current?.focus()
          }}
          className={`flex-shrink-0 px-3 py-1 text-xs uppercase tracking-wider border focus:outline-none focus:ring-0 ${
            activeGroup === null
              ? 'bg-primary text-white border-primary'
              : 'border-gray-300 text-gray-600 hover:border-primary hover:text-primary'
          }`}
        >
          All
        </button>
        {config.groups.map((g) => (
          <button
            type="button"
            key={g.id}
            onClick={() => {
              setActiveGroup(g.id)
              inputRef.current?.focus()
            }}
            className={`flex-shrink-0 px-3 py-1 text-xs uppercase tracking-wider border focus:outline-none focus:ring-0 ${
              activeGroup === g.id
                ? 'bg-primary text-white border-primary'
                : 'border-gray-300 text-gray-600 hover:border-primary hover:text-primary'
            }`}
          >
            {g.name}
          </button>
        ))}
      </div>

      {/* ── Search input ────────────────────────────────────── */}
      <div className="relative z-20 mb-4">
        <div
          className={`flex items-center border px-3 bg-white relative z-40 ${
            dropdownOpen ? 'border-primary border-b-0' : 'border-gray-300'
          }`}
        >
          <Search size={16} className="text-gray-400 mr-2 flex-shrink-0" />
          <input
            ref={inputRef}
            className="w-full py-2 bg-transparent border-none border-0 outline-none focus:ring-0 focus:outline-none focus:border-transparent text-sm"
            placeholder="Search criteria by name or keyword..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setFocusIdx(-1)
              setDropdownOpen(true)
            }}
            onFocus={() => setDropdownOpen(true)}
            onKeyDown={onKeyDown}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
          <ChevronDown
            size={14}
            className={`ml-1 text-gray-400 transition ${
              dropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </div>

        {/* Dropdown */}
        {dropdownOpen && (
          <div className="absolute w-full border border-primary border-t-0 bg-white shadow-md max-h-64 overflow-y-auto z-30">
            {!query && (
              <div className="px-3 py-1 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wider">
                All available criteria &mdash; type to filter
              </div>
            )}
            {results.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">
                No matching criteria found
              </div>
            ) : (
              <ul ref={listboxRef}>
                {results.map((r, i) => (
                  <li key={r.field.id} onMouseEnter={() => setFocusIdx(i)}>
                    <button
                      type="button"
                      className={`w-full text-left px-3 py-2 flex justify-between items-center border-b border-gray-50 last:border-0 text-sm outline-none ${
                        focusIdx === i ? 'bg-red-50' : 'hover:bg-gray-50'
                      }`}
                      onClick={() => addField(r.field)}
                    >
                      <div className="min-w-0 mr-2">
                        <div className="font-medium text-gray-800 whitespace-normal text-left">
                          <HighlightMatch
                            text={r.field.label || r.field.name}
                            query={query}
                          />
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {r.groupName}
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {typeLabel(r.field)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Click-away */}
      {dropdownOpen && (
        <button
          type="button"
          aria-label="Close search dropdown"
          className="fixed inset-0 z-10 w-full h-full cursor-default bg-transparent outline-none border-none"
          onClick={() => setDropdownOpen(false)}
        />
      )}

      {/* ── Templates ───────────────────────────────────────── */}
      {visibleFieldsSet.size === 0 && (
        <div className="mb-6">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
            Quick-start templates
          </div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <button
                type="button"
                key={t.name}
                onClick={() => applyTemplate(t.fieldNames)}
                className="px-3 py-2 border border-gray-300 text-sm text-gray-700 hover:border-primary hover:text-primary"
              >
                {t.name}{' '}
                <span className="text-gray-400">({t.fieldNames.length})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Related suggestion ─────────────────────────────── */}
      {relSuggestion && (
        <div className="mb-4 border border-yellow-300 bg-yellow-50 p-3">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-sm font-semibold text-gray-800 mb-1">
                Related: {relSuggestion.reason}
              </div>
              <div className="text-xs text-gray-500 mb-2">
                You added{' '}
                <span className="font-medium">{relSuggestion.source}</span> —
                consider also:
              </div>
              <div className="flex flex-wrap gap-1">
                {relSuggestion.fields
                  .filter((rf) => !visibleFieldsSet.has(rf.field.id))
                  .map((rf) => (
                    <button
                      type="button"
                      key={rf.field.id}
                      onClick={() => addField(rf.field)}
                      className="text-xs px-2 py-1 border border-yellow-400 text-yellow-800 hover:bg-yellow-100"
                    >
                      + {rf.field.label || rf.field.name}
                    </button>
                  ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRelSuggestion(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Selected criteria ──────────────────────────────── */}
      {topLevelFields.length > 0 && (
        <form ref={formRef}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-500 uppercase tracking-wider">
              Selected criteria ({visibleFieldsSet.size})
            </span>
          </div>

          {/* Render important questions always exposed */}
          {(() => {
            const importantFields = topLevelFields.filter((field) =>
              importantQuestionsConfig.groups.some(
                (ig) => ig.name === field.name
              )
            )
            if (importantFields.length === 0) return null
            return (
              <div className="space-y-3 mb-6">
                {importantFields
                  .reverse()
                  .map((field) => renderField(field, 0))}
              </div>
            )
          })()}

          {/* Grouped other fields - dynamically hoisted to the top based on newest activity! */}
          {(() => {
            const insertionOrderArr = Array.from(visibleFieldsSet)

            const activeGroups = config.groups
              .map((group) => {
                const groupFields = topLevelFields.filter(
                  (f) =>
                    f.groupId === group.id &&
                    !importantQuestionsConfig.groups.some(
                      (ig) => ig.name === f.name
                    )
                )

                let maxIdx = -1
                for (const gf of groupFields) {
                  const idx = insertionOrderArr.indexOf(gf.id)
                  if (idx > maxIdx) maxIdx = idx
                }

                return {
                  group,
                  groupFields: groupFields.reverse(),
                  maxIdx,
                }
              })
              .filter((x) => x.groupFields.length > 0)
              .sort((a, b) => b.maxIdx - a.maxIdx)

            return activeGroups.map(({ group, groupFields }, i) => (
              <DropdownSection
                key={group.id}
                backgroundColor="bg-white"
                name={group.name || 'General'}
                isCollapsedAtStart={i !== 0}
              >
                <div className="space-y-3 my-2">
                  {groupFields.map((field) => renderField(field, 0))}
                </div>
              </DropdownSection>
            ))
          })()}
        </form>
      )}

      {visibleFieldsSet.size === 0 && (
        <div className="text-center text-gray-400 py-8 text-sm">
          Search above or pick a template to add criteria
        </div>
      )}
    </div>
  )
}
