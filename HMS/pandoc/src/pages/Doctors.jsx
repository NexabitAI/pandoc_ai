import React, { useContext, useEffect, useState } from 'react'
import { AppContext } from '../context/AppContext'
import { useNavigate, useParams } from 'react-router-dom'

const Doctors = () => {

  const { speciality } = useParams()

  const [filterDoc, setFilterDoc] = useState([])
  const [showFilter, setShowFilter] = useState(false)
  const navigate = useNavigate();

  // fetch doctors as before + get backendUrl for specialties endpoint
  const { doctors, backendUrl } = useContext(AppContext)

  // NEW: dynamic specialties
  const [specialties, setSpecialties] = useState([])
  const [loadingSpecs, setLoadingSpecs] = useState(true)

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

        <div className={`flex-col gap-4 text-sm text-gray-600 ${showFilter ? 'flex' : 'hidden sm:flex'}`}>
          {(specialties.length ? specialties : [
            'General physician',
            'Gynecologist',
            'Dermatologist',
            'Pediatricians',
            'Neurologist',
            'Gastroenterologist'
          ]).map((s) => (
            <p
              key={s}
              onClick={() => speciality === s ? navigate('/doctors') : navigate(`/doctors/${encodeURIComponent(s)}`)}
              className={`w-[94vw] sm:w-auto pl-3 py-1.5 pr-16 border border-gray-300 rounded transition-all cursor-pointer ${speciality === s ? 'bg-[#E2E5FF] text-black ' : ''}`}
              title={s}
            >
              {s}
            </p>
          ))}

          {loadingSpecs && specialties.length === 0 && (
            <span className='text-xs text-gray-500 mt-1'>Loading specialties…</span>
          )}
        </div>

        <div className='w-full grid grid-cols-auto gap-4 gap-y-6'>
          {filterDoc.map((item, index) => (
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
      </div>
    </div>
  )
}

export default Doctors
