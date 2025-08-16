import { describe, it, expect, beforeEach } from "vitest"

// Mock Clarity contract functions for testing
const mockContract = {
  materials: new Map(),
  materialHistory: new Map(),
  ownerMaterials: new Map(),
  materialEventCount: new Map(),
  nextMaterialId: 1,
  totalMaterials: 0,
  
  // Constants
  STATUS_PRODUCED: 1,
  STATUS_IN_USE: 2,
  STATUS_COLLECTED: 3,
  STATUS_RECYCLED: 4,
  STATUS_DISPOSED: 5,
  
  ERR_NOT_AUTHORIZED: 100,
  ERR_MATERIAL_NOT_FOUND: 101,
  ERR_INVALID_INPUT: 102,
  ERR_ALREADY_EXISTS: 103,
  ERR_INVALID_STATUS: 104,
}

// Mock transaction sender
let mockTxSender = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"

// Helper functions
function createMaterial(materialType, weight, initialQuality, carbonFootprint) {
  if (weight <= 0 || initialQuality > 100) {
    return { error: mockContract.ERR_INVALID_INPUT }
  }
  
  const materialId = mockContract.nextMaterialId
  const blockHeight = Date.now()
  
  mockContract.materials.set(materialId, {
    creator: mockTxSender,
    currentOwner: mockTxSender,
    materialType,
    weight,
    qualityScore: initialQuality,
    status: mockContract.STATUS_PRODUCED,
    createdAt: blockHeight,
    lastUpdated: blockHeight,
    recyclingCount: 0,
    carbonFootprint,
  })
  
  // Add to owner materials
  const ownerMaterials = mockContract.ownerMaterials.get(mockTxSender) || []
  ownerMaterials.push(materialId)
  mockContract.ownerMaterials.set(mockTxSender, ownerMaterials)
  
  // Add history event
  mockContract.materialHistory.set(`${materialId}-0`, {
    eventType: "CREATED",
    fromOwner: null,
    toOwner: mockTxSender,
    timestamp: blockHeight,
    qualityChange: 0,
    notes: "Material created",
  })
  
  mockContract.materialEventCount.set(materialId, 1)
  mockContract.nextMaterialId++
  mockContract.totalMaterials++
  
  return { success: materialId }
}

function getMaterial(materialId) {
  return mockContract.materials.get(materialId) || null
}

function transferMaterial(materialId, newOwner) {
  const material = mockContract.materials.get(materialId)
  if (!material) {
    return { error: mockContract.ERR_MATERIAL_NOT_FOUND }
  }
  
  if (material.currentOwner !== mockTxSender) {
    return { error: mockContract.ERR_NOT_AUTHORIZED }
  }
  
  // Update material
  material.currentOwner = newOwner
  material.lastUpdated = Date.now()
  mockContract.materials.set(materialId, material)
  
  // Update owner materials
  const oldOwnerMaterials = mockContract.ownerMaterials.get(mockTxSender) || []
  const newOwnerMaterials = mockContract.ownerMaterials.get(newOwner) || []
  
  mockContract.ownerMaterials.set(
      mockTxSender,
      oldOwnerMaterials.filter((id) => id !== materialId),
  )
  mockContract.ownerMaterials.set(newOwner, [...newOwnerMaterials, materialId])
  
  // Add history event
  const eventCount = mockContract.materialEventCount.get(materialId) || 0
  mockContract.materialHistory.set(`${materialId}-${eventCount}`, {
    eventType: "TRANSFER",
    fromOwner: mockTxSender,
    toOwner: newOwner,
    timestamp: Date.now(),
    qualityChange: 0,
    notes: "Ownership transferred",
  })
  
  mockContract.materialEventCount.set(materialId, eventCount + 1)
  
  return { success: true }
}

function recycleMaterial(materialId, qualityLoss) {
  const material = mockContract.materials.get(materialId)
  if (!material) {
    return { error: mockContract.ERR_MATERIAL_NOT_FOUND }
  }
  
  if (material.currentOwner !== mockTxSender) {
    return { error: mockContract.ERR_NOT_AUTHORIZED }
  }
  
  if (qualityLoss > material.qualityScore) {
    return { error: mockContract.ERR_INVALID_INPUT }
  }
  
  const newQuality = material.qualityScore - qualityLoss
  material.qualityScore = newQuality
  material.status = mockContract.STATUS_RECYCLED
  material.recyclingCount++
  material.lastUpdated = Date.now()
  
  mockContract.materials.set(materialId, material)
  
  // Add history event
  const eventCount = mockContract.materialEventCount.get(materialId) || 0
  mockContract.materialHistory.set(`${materialId}-${eventCount}`, {
    eventType: "RECYCLED",
    fromOwner: null,
    toOwner: mockTxSender,
    timestamp: Date.now(),
    qualityChange: -qualityLoss,
    notes: "Material recycled",
  })
  
  mockContract.materialEventCount.set(materialId, eventCount + 1)
  
  return { success: newQuality }
}

describe("Material Tracking Contract", () => {
  beforeEach(() => {
    // Reset mock contract state
    mockContract.materials.clear()
    mockContract.materialHistory.clear()
    mockContract.ownerMaterials.clear()
    mockContract.materialEventCount.clear()
    mockContract.nextMaterialId = 1
    mockContract.totalMaterials = 0
    mockTxSender = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
  })
  
  describe("Material Creation", () => {
    it("should create a new material successfully", () => {
      const result = createMaterial("plastic", 1000, 95, 50)
      
      expect(result.success).toBe(1)
      
      const material = getMaterial(1)
      expect(material).toBeTruthy()
      expect(material.materialType).toBe("plastic")
      expect(material.weight).toBe(1000)
      expect(material.qualityScore).toBe(95)
      expect(material.status).toBe(mockContract.STATUS_PRODUCED)
      expect(material.recyclingCount).toBe(0)
    })
    
    it("should reject invalid weight", () => {
      const result = createMaterial("plastic", 0, 95, 50)
      expect(result.error).toBe(mockContract.ERR_INVALID_INPUT)
    })
    
    it("should reject invalid quality score", () => {
      const result = createMaterial("plastic", 1000, 150, 50)
      expect(result.error).toBe(mockContract.ERR_INVALID_INPUT)
    })
    
    it("should increment material ID for each creation", () => {
      createMaterial("plastic", 1000, 95, 50)
      createMaterial("metal", 2000, 90, 75)
      
      expect(mockContract.nextMaterialId).toBe(3)
      expect(mockContract.totalMaterials).toBe(2)
    })
  })
  
  describe("Material Transfer", () => {
    it("should transfer material to new owner", () => {
      createMaterial("plastic", 1000, 95, 50)
      const newOwner = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG"
      
      const result = transferMaterial(1, newOwner)
      expect(result.success).toBe(true)
      
      const material = getMaterial(1)
      expect(material.currentOwner).toBe(newOwner)
    })
    
    it("should reject transfer by non-owner", () => {
      createMaterial("plastic", 1000, 95, 50)
      mockTxSender = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG"
      
      const result = transferMaterial(1, "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP")
      expect(result.error).toBe(mockContract.ERR_NOT_AUTHORIZED)
    })
    
    it("should reject transfer of non-existent material", () => {
      const result = transferMaterial(999, "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG")
      expect(result.error).toBe(mockContract.ERR_MATERIAL_NOT_FOUND)
    })
  })
  
  describe("Material Recycling", () => {
    it("should recycle material with quality loss", () => {
      createMaterial("plastic", 1000, 95, 50)
      
      const result = recycleMaterial(1, 10)
      expect(result.success).toBe(85)
      
      const material = getMaterial(1)
      expect(material.qualityScore).toBe(85)
      expect(material.status).toBe(mockContract.STATUS_RECYCLED)
      expect(material.recyclingCount).toBe(1)
    })
    
    it("should reject recycling with excessive quality loss", () => {
      createMaterial("plastic", 1000, 95, 50)
      
      const result = recycleMaterial(1, 100)
      expect(result.error).toBe(mockContract.ERR_INVALID_INPUT)
    })
    
    it("should track multiple recycling cycles", () => {
      createMaterial("plastic", 1000, 95, 50)
      
      recycleMaterial(1, 10)
      recycleMaterial(1, 15)
      
      const material = getMaterial(1)
      expect(material.qualityScore).toBe(70)
      expect(material.recyclingCount).toBe(2)
    })
  })
  
  describe("Material History", () => {
    it("should track material creation event", () => {
      createMaterial("plastic", 1000, 95, 50)
      
      const history = mockContract.materialHistory.get("1-0")
      expect(history).toBeTruthy()
      expect(history.eventType).toBe("CREATED")
      expect(history.notes).toBe("Material created")
    })
    
    it("should track transfer events", () => {
      createMaterial("plastic", 1000, 95, 50)
      transferMaterial(1, "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG")
      
      const history = mockContract.materialHistory.get("1-1")
      expect(history).toBeTruthy()
      expect(history.eventType).toBe("TRANSFER")
      expect(history.fromOwner).toBe(mockTxSender)
    })
    
    it("should track recycling events", () => {
      createMaterial("plastic", 1000, 95, 50)
      recycleMaterial(1, 10)
      
      const history = mockContract.materialHistory.get("1-1")
      expect(history).toBeTruthy()
      expect(history.eventType).toBe("RECYCLED")
      expect(history.qualityChange).toBe(-10)
    })
  })
})
