import React, { useContext, useState, useEffect } from 'react'
import { assets } from '../../assets/assets'
import { toast } from 'react-toastify'
import axios from 'axios'
import { AdminContext } from '../../context/AdminContext'
import { AppContext } from '../../context/AppContext'

const AddDoctor = () => {
  const [docImg, setDocImg] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [experience, setExperience] = useState('1 Year')
  const [fees, setFees] = useState('')
  const [about, setAbout] = useState('')
  const [speciality, setSpeciality] = useState('General physician')
  const [degree, setDegree] = useState('')
  const [address1, setAddress1] = useState('')
  const [address2, setAddress2] = useState('')

  // NEW: dynamic specialties
  const [specialties, setSpecialties] = useState([])
  const [loadingSpecs, setLoadingSpecs] = useState(true)

  const { backendUrl } = useContext(AppContext)
  const { aToken } = useContext(AdminContext)

  // Fetch specialties from backend once
  useEffect(() => {
    let isMounted = true
    ;(async () => {
      try {
        const res = await fetch(`${backendUrl}/api/specialties`)
        const json = await res.json()
        if (!isMounted) return
        if (json?.success && Array.isArray(json.data)) {
          setSpecialties(json.data)
          // if current default isn't in list, select the first one
          if (json.data.length > 0 && !json.data.includes(speciality)) {
            setSpeciality(json.data[0])
          }
        } else {
          // fallback handled by rendering code below
          console.warn('Specialties endpoint returned unexpected payload.')
        }
      } catch (e) {
        console.error('Failed to load specialties', e)
        toast.error('Failed to load specialties')
      } finally {
        if (isMounted) setLoadingSpecs(false)
      }
    })()
    return () => { isMounted = false }
  }, [backendUrl]) // run once per mount/backendUrl change

  const onSubmitHandler = async (event) => {
    event.preventDefault()
    try {
      if (!docImg) {
        return toast.error('Image Not Selected')
      }

      const formData = new FormData()
      formData.append('image', docImg)
      formData.append('name', name)
      formData.append('email', email)
      formData.append('password', password)
      formData.append('experience', experience)
      formData.append('fees', Number(fees))
      formData.append('about', about)
      formData.append('speciality', speciality)
      formData.append('degree', degree)
      formData.append('address', JSON.stringify({ line1: address1, line2: address2 }))

      // debug: log formdata
      formData.forEach((value, key) => {
        console.log(`${key}: ${value}`)
      })

      const { data } = await axios.post(backendUrl + '/api/admin/add-doctor', formData, { headers: { aToken } })
      if (data.success) {
        toast.success(data.message)
        setDocImg(false)
        setName('')
        setPassword('')
        setEmail('')
        setAddress1('')
        setAddress2('')
        setDegree('')
        setAbout('')
        setFees('')
        // keep selected speciality as-is for quicker repeated adds
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error(error.message)
      console.log(error)
    }
  }

  return (
    <form onSubmit={onSubmitHandler} className='m-5 w-full'>

      <p className='mb-3 text-lg font-medium'>Add Doctor</p>

      <div className='bg-white px-8 py-8 border rounded w-full max-w-4xl max-h-[80vh] overflow-y-scroll'>
        <div className='flex items-center gap-4 mb-8 text-gray-500'>
          <label htmlFor="doc-img">
            <img
              className='w-16 bg-gray-100 rounded-full cursor-pointer'
              src={docImg ? URL.createObjectURL(docImg) : assets.upload_area}
              alt=""
            />
          </label>
          <input onChange={(e) => setDocImg(e.target.files[0])} type="file" id="doc-img" hidden />
          <p>Upload doctor <br /> picture</p>
        </div>

        <div className='flex flex-col lg:flex-row items-start gap-10 text-gray-600'>

          <div className='w-full lg:flex-1 flex flex-col gap-4'>

            <div className='flex-1 flex flex-col gap-1'>
              <p>Your name</p>
              <input onChange={e => setName(e.target.value)} value={name} className='border rounded px-3 py-2' type="text" placeholder='Name' required />
            </div>

            <div className='flex-1 flex flex col gap-1'>
              <p>Doctor Email</p>
              <input onChange={e => setEmail(e.target.value)} value={email} className='border rounded px-3 py-2' type="email" placeholder='Email' required />
            </div>

            <div className='flex-1 flex flex-col gap-1'>
              <p>Set Password</p>
              <input onChange={e => setPassword(e.target.value)} value={password} className='border rounded px-3 py-2' type="password" placeholder='Password' required />
            </div>

            <div className='flex-1 flex flex-col gap-1'>
              <p>Experience</p>
              <select onChange={e => setExperience(e.target.value)} value={experience} className='border rounded px-2 py-2' >
                <option value="1 Year">1 Year</option>
                <option value="2 Year">2 Years</option>
                <option value="3 Year">3 Years</option>
                <option value="4 Year">4 Years</option>
                <option value="5 Year">5 Years</option>
                <option value="6 Year">6 Years</option>
                <option value="8 Year">8 Years</option>
                <option value="9 Year">9 Years</option>
                <option value="10 Year">10 Years</option>
              </select>
            </div>

            <div className='flex-1 flex flex-col gap-1'>
              <p>Fees</p>
              <input onChange={e => setFees(e.target.value)} value={fees} className='border rounded px-3 py-2' type="number" placeholder='Doctor fees' required />
            </div>

          </div>

          <div className='w-full lg:flex-1 flex flex-col gap-4'>

            <div className='flex-1 flex flex-col gap-1'>
              <p>Speciality</p>
              <select
                onChange={e => setSpeciality(e.target.value)}
                value={speciality}
                className='border rounded px-2 py-2'
                disabled={loadingSpecs && specialties.length === 0}
              >
                {/* Fallback to original 6 if API not ready */}
                {(specialties.length ? specialties : [
                  'General physician', 'Gynecologist', 'Dermatologist',
                  'Pediatricians', 'Neurologist', 'Gastroenterologist'
                ]).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {loadingSpecs && specialties.length === 0 && (
                <span className='text-xs text-gray-500 mt-1'>Loading specialties…</span>
              )}
            </div>

            <div className='flex-1 flex flex-col gap-1'>
              <p>Degree</p>
              <input onChange={e => setDegree(e.target.value)} value={degree} className='border rounded px-3 py-2' type="text" placeholder='Degree' required />
            </div>

            <div className='flex-1 flex flex-col gap-1'>
              <p>Address</p>
              <input onChange={e => setAddress1(e.target.value)} value={address1} className='border rounded px-3 py-2' type="text" placeholder='Address 1' required />
              <input onChange={e => setAddress2(e.target.value)} value={address2} className='border rounded px-3 py-2' type="text" placeholder='Address 2' required />
            </div>

          </div>

        </div>

        <div>
          <p className='mt-4 mb-2'>About Doctor</p>
          <textarea onChange={e => setAbout(e.target.value)} value={about} className='w-full px-4 pt-2 border rounded' rows={5} placeholder='write about doctor'></textarea>
        </div>

        <button type='submit' className='bg-primary px-10 py-3 mt-4 text-white rounded-full'>Add doctor</button>
      </div>

    </form>
  )
}

export default AddDoctor
