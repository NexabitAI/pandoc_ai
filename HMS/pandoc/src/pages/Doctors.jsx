import React, { useContext, useEffect, useRef, useState } from 'react'
import { AppContext } from '../context/AppContext'
import { useNavigate, useParams } from 'react-router-dom'

const FALLBACK_SPECIALTIES = [
  'General physician',
  'Gynecologist',
  'Dermatologist',
  'Pediatricians',
  'Neurologist',
  'Gastroenterologist'
];

const MIN_CARD_WIDTH_PX = 240;      // used to estimate columns for 2-rows pagination
const SPECS_PER_VIEW = 8;           // how many specialties to show at once in the vertical carousel

const Doctors = () => {

  const { speciality } = useParams()

  const [filterDoc, setFilterDoc] = useState([])
  const [showFilter, setShowFilter] = useState(false)
  const navigate = useNavigate();

  // fetch doctors as before + get backendUrl for specialties endpoint
  const { doctors, backendUrl } = useContext(AppContext)

  // dynamic specialties
  const [specialties, setSpecialties] = useState([])
  const [loadingSpecs, setLoadingSpecs] = useState(true)

  // vertical carousel window start index
  const [specStart, setSpecStart] = useState(0)

  // grid sizing to paginate by rows
  const gridRef = useRef(null)
  const [cols, setCols] = useState(1)      // estimated columns in the grid
  const [rowsToShow, setRowsToShow] = useState(2) // start with 2 rows

  const applyFilter = () => {
    if (speciality) {
      setFilterDoc(doctors.filter(doc => doc.speciality === speciality))
    } else {
      setFilterDoc(doctors)
    }
  }

  useEffect(() => {
    applyFilter()
  }, [doctors, speciality])

  // fetch specialties once
  useEffect(() => {
    let isMounted = true
    ;(async () => {
      try {
        const res = await fetch(`${backendUrl}/api/specialties`)
        const json = await res.json()
        if (!isMounted) return
        if (json?.success && Array.isArray(json.data)) {
          setSpecialties(json.data)
        }
      } catch (e) {
        console.error('Failed to load specialties', e)
      } finally {
        if (isMounted) setLoadingSpecs(false)
      }
    })()
    return () => { isMounted = false }
  }, [backendUrl])

  // observe grid width → estimate columns so we can show N rows initially
  useEffect(() => {
    if (!gridRef.current) return
    const el = gridRef.current
    const measure = () => {
      const w = el.clientWidth || 1
      const c = Math.max(1, Math.floor(w / MIN_CARD_WIDTH_PX))
      setCols(c)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // vertical carousel helpers
  const listForFilter = (specialties.length ? specialties : FALLBACK_SPECIALTIES)
  const totalSpecs = listForFilter.length
  const showArrows = totalSpecs > SPECS_PER_VIEW

  const sliceSpecs = () => {
    if (totalSpecs <= SPECS_PER_VIEW) return listForFilter
    const end = specStart + SPECS_PER_VIEW
    return end <= totalSpecs
      ? listForFilter.slice(specStart, end)
      : [...listForFilter.slice(specStart), ...listForFilter.slice(0, end - totalSpecs)]
  }

  const nextSpecs = () => {
    if (!showArrows) return
    setSpecStart((prev) => (prev + SPECS_PER_VIEW) % totalSpecs)
  }

  const prevSpecs = () => {
    if (!showArrows) return
    setSpecStart((prev) => (prev - SPECS_PER_VIEW + totalSpecs) % totalSpecs)
  }

  // docs pagination by rows
  const visibleCount = cols * rowsToShow
  const visibleDocs = filterDoc.slice(0, visibleCount)
  const canLoadMore = visibleCount < filterDoc.length

  return (
    <div>
      <p className='text-gray-600'>Browse through the doctors specialist.</p>
      <div className='flex flex-col sm:flex-row items-start gap-5 mt-5'>

        <button
          onClick={() => setShowFilter(!showFilter)}
          className={`py-1 px-3 border rounded text-sm transition-all sm:hidden ${showFilter ? 'bg-primary text-white' : ''}`}
        >
          Filters
        </button>

        {/* Vertical carousel filter */}
        <div className={`flex-col gap-2 text-sm text-gray-600 ${showFilter ? 'flex' : 'hidden sm:flex'}`}>

          {/* "All" stays outside carousel */}
          <p
            onClick={() => navigate('/doctors')}
            className={`w-[94vw] sm:w-56 pl-3 py-1.5 pr-4 border border-gray-300 rounded transition-all cursor-pointer ${!speciality ? 'bg-[#E2E5FF] text-black ' : ''}`}
          >
            All Specialties
          </p>

          {/* Controls */}
          {showArrows && (
            <div className="flex flex-col items-stretch gap-2">
              <button
                onClick={prevSpecs}
                className="border border-gray-300 rounded px-3 py-1 hover:bg-gray-50"
                aria-label="Previous specialties"
              >
                ▲
              </button>
              <button
                onClick={nextSpecs}
                className="border border-gray-300 rounded px-3 py-1 hover:bg-gray-50"
                aria-label="Next specialties"
              >
                ▼
              </button>
            </div>
          )}

          {/* Window of specialties */}
          <div className="flex flex-col gap-2">
            {sliceSpecs().map((s) => (
              <p
                key={s}
                onClick={() => speciality === s ? navigate('/doctors') : navigate(`/doctors/${encodeURIComponent(s)}`)}
                className={`w-[94vw] sm:w-56 pl-3 py-1.5 pr-4 border border-gray-300 rounded transition-all cursor-pointer ${speciality === s ? 'bg-[#E2E5FF] text-black ' : ''}`}
                title={s}
              >
                {s}
              </p>
            ))}
          </div>

          {loadingSpecs && specialties.length === 0 && (
            <span className='text-xs text-gray-500 mt-1'>Loading specialties…</span>
          )}
        </div>

        {/* Doctors grid */}
        <div className='w-full'>
          <div ref={gridRef} className='grid grid-cols-auto gap-4 gap-y-6'>
            {visibleDocs.map((item, index) => (
              <div
                onClick={() => { navigate(`/appointment/${item._id}`); scrollTo(0, 0) }}
                className='border border-[#C9D8FF] rounded-xl overflow-hidden cursor-pointer hover:translate-y-[-10px] transition-all duration-500'
                key={index}
              >
                <img className='bg-[#EAEFFF]' src={item.image} alt="" />
                <div className='p-4'>
                  <div className={`flex items-center gap-2 text-sm text-center ${item.available ? 'text-green-500' : "text-gray-500"}`}>
                    <p className={`w-2 h-2 rounded-full ${item.available ? 'bg-green-500' : "bg-gray-500"}`}></p>
                    <p>{item.available ? 'Available' : "Not Available"}</p>
                  </div>
                  <p className='text-[#262626] text-lg font-medium'>{item.name}</p>
                  <p className='text-[#5C5C5C] text-sm'>{item.speciality}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Load more */}
          {canLoadMore && (
            <div className='flex justify-center mt-6'>
              <button
                onClick={() => setRowsToShow(r => r + 1)}
                className='px-4 py-2 border border-gray-300 rounded hover:bg-gray-50'
              >
                Load more
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

export default Doctors
